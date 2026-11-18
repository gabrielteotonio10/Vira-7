/**
 * Testa as migrations em um Postgres real embutido (PGlite), sem precisar do Supabase:
 * estrutura, triggers, funções atômicas e políticas de segurança (RLS).
 *
 *   npm install        (uma vez)
 *   npm run test:db
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '..', 'migrations');
const migrations = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

const db = new PGlite();
const rows = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await rows(sql, params))[0];

/** Executa `fn` como um usuário autenticado (ou anônimo), como o Supabase faria. */
async function as(role, userId, fn) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${userId || ''}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

async function signUp(username, avatar = 'raposa') {
  const meta = JSON.stringify({ username, avatar });
  const user = await one(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`,
    [`${username}-${Math.random().toString(36).slice(2)}@teste.dev`, meta],
  );
  return user.id;
}

const createRoom = (host, { visibility = 'private', max = 4 } = {}) =>
  one(`select * from vira7_create_room($1, 'Sala de teste', $2, 'custom', $3, 200, 30)`, [host, visibility, max]);

const event = (seq, type = 'cardDrawn') => ({ seq, type, payload: { n: seq }, state: { seq } });

async function startGame(room, { seq = 2 } = {}) {
  const ids = (await rows(`select id from room_players where room_id = $1 and status = 'joined' order by seat`, [room.id]))
    .map((r) => r.id);
  const game = await one(
    `select vira7_start_game($1, $2::uuid[], $3::jsonb, $4::jsonb, $5::jsonb, null, null) as id`,
    [room.id, ids, JSON.stringify({ round: 1, seq }), JSON.stringify({ seed: 123 }), JSON.stringify([event(1, 'gameStart'), event(2)])],
  );
  return game.id;
}

test('as migrations aplicam sem erros e são idempotentes', async () => {
  await db.exec(fs.readFileSync(path.join(here, 'supabase-stub.sql'), 'utf8'));
  for (let pass = 1; pass <= 2; pass++) {
    for (const file of migrations) {
      try {
        await db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
      } catch (error) {
        assert.fail(`${file} (execução ${pass}): ${error.message}`);
      }
    }
  }
  assert.equal(migrations.length, 8);
});

test('cadastro cria perfil, preferências e estatísticas', async () => {
  const id = await signUp('Gabriel_7', 'panda');
  const profile = await one(`select username, avatar from profiles where id = $1`, [id]);
  assert.deepEqual(profile, { username: 'Gabriel_7', avatar: 'panda' });
  assert.equal((await one(`select count(*)::int as n from user_settings where user_id = $1`, [id])).n, 1);
  assert.equal((await one(`select games_played from player_stats where user_id = $1`, [id])).games_played, 0);
});

test('nome de usuário repetido ou inválido recebe um nome livre', async () => {
  const dup = await signUp('gabriel_7');
  const bad = await signUp('x!');
  for (const id of [dup, bad]) {
    const { username } = await one(`select username from profiles where id = $1`, [id]);
    assert.match(username, /^jogador_[0-9a-f]{6}$/);
  }
  await assert.rejects(db.query(`update profiles set username = 'GABRIEL_7' where id = $1`, [dup]), /profiles_username_lower_key/);
  await assert.rejects(db.query(`update profiles set avatar = 'dragao' where id = $1`, [dup]), /profiles_avatar_valid/);
});

test('criar sala gera código válido e coloca o anfitrião no assento 0', async () => {
  const host = await signUp('anfitriao');
  const room = await createRoom(host);
  assert.match(room.code, /^[A-Z2-9]{6}$/);
  assert.equal(room.status, 'lobby');
  const players = await rows(`select user_id, seat, is_ready from room_players where room_id = $1`, [room.id]);
  assert.deepEqual(players, [{ user_id: host, seat: 0, is_ready: false }]);
  await assert.rejects(createRoom(host), /ALREADY_IN_ROOM/);
});

test('entrar respeita lotação, assentos e uma sala por pessoa', async () => {
  const [a, b, c, d] = await Promise.all(['ana', 'beto', 'caio', 'duda'].map((n) => signUp(`${n}_sala`)));
  const room = await createRoom(a, { max: 3 });

  const pb = await one(`select * from vira7_join_room($1, $2)`, [room.id, b]);
  assert.equal(pb.seat, 1);
  // Entrar de novo (reconexão) devolve a mesma linha.
  assert.equal((await one(`select * from vira7_join_room($1, $2)`, [room.id, b])).id, pb.id);

  const bot = await one(`select * from vira7_add_bot($1, 'Rita', 'coruja')`, [room.id]);
  assert.equal(bot.seat, 2);
  assert.equal(bot.is_ready, true);

  await assert.rejects(db.query(`select vira7_join_room($1, $2)`, [room.id, c]), /ROOM_FULL/);
  await assert.rejects(db.query(`select vira7_add_bot($1, 'Beto', 'urso')`, [room.id]), /ROOM_FULL/);

  const other = await createRoom(d);
  await assert.rejects(db.query(`select vira7_join_room($1, $2)`, [other.id, b]), /ALREADY_IN_ROOM/);
  await assert.rejects(
    db.query(`select vira7_join_room('00000000-0000-0000-0000-000000000000', $1)`, [c]),
    /ROOM_NOT_FOUND/,
  );
});

test('sair transfere o anfitrião, libera o assento e fecha a sala vazia', async () => {
  const [a, b] = await Promise.all([signUp('host_sai'), signUp('fica_host')]);
  const room = await createRoom(a);
  await db.query(`select vira7_join_room($1, $2)`, [room.id, b]);

  const left = (await one(`select vira7_leave_room($1, $2) as r`, [room.id, a])).r;
  assert.deepEqual(left, { left: true, closed: false, host_id: b });
  assert.equal((await one(`select host_id from rooms where id = $1`, [room.id])).host_id, b);

  // O assento 0 ficou livre e quem saiu pode voltar.
  const back = await one(`select * from vira7_join_room($1, $2)`, [room.id, a]);
  assert.equal(back.seat, 0);

  await db.query(`select vira7_leave_room($1, $2)`, [room.id, a]);
  const last = (await one(`select vira7_leave_room($1, $2) as r`, [room.id, b])).r;
  assert.equal(last.closed, true);
  assert.equal((await one(`select status from rooms where id = $1`, [room.id])).status, 'closed');
  await assert.rejects(db.query(`select vira7_join_room($1, $2)`, [room.id, a]), /ROOM_NOT_OPEN/);
});

test('só uma partida começa por sala, e não se a lista de jogadores mudou', async () => {
  const [a, b, c] = await Promise.all([signUp('ini_a'), signUp('ini_b'), signUp('ini_c')]);
  const room = await createRoom(a);
  await db.query(`select vira7_join_room($1, $2)`, [room.id, b]);

  const stale = (await rows(`select id from room_players where room_id = $1 order by seat`, [room.id])).map((r) => r.id);
  await db.query(`select vira7_join_room($1, $2)`, [room.id, c]);
  const refused = await one(
    `select vira7_start_game($1, $2::uuid[], '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, null, null) as id`,
    [room.id, stale],
  );
  assert.equal(refused.id, null, 'lista desatualizada não inicia a partida');

  const gameId = await startGame(room);
  assert.ok(gameId);
  assert.equal(await startGame(room), null, 'a sala já está jogando');

  const state = await one(`select status, current_game_id from rooms where id = $1`, [room.id]);
  assert.deepEqual(state, { status: 'playing', current_game_id: gameId });
  assert.equal((await one(`select count(*)::int as n from game_events where game_id = $1`, [gameId])).n, 2);
  assert.deepEqual((await one(`select state from game_secrets where game_id = $1`, [gameId])).state, { seed: 123 });
});

test('jogadas simultâneas: só a primeira versão é aceita', async () => {
  const [a, b] = await Promise.all([signUp('conc_a'), signUp('conc_b')]);
  const room = await createRoom(a);
  await db.query(`select vira7_join_room($1, $2)`, [room.id, b]);
  const gameId = await startGame(room);

  const commit = (version, seq) =>
    one(
      `select vira7_commit_game($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, null, 'playing', null, null, null, null) as ok`,
      [gameId, version, JSON.stringify({ round: 1, seq }), JSON.stringify({ seed: 123, n: seq }), JSON.stringify([event(seq)]), b],
    );

  assert.equal((await commit(1, 3)).ok, true);
  assert.equal((await commit(1, 3)).ok, false, 'a segunda jogada sobre a mesma versão é recusada');
  assert.equal((await commit(2, 4)).ok, true);

  const game = await one(`select version, last_seq, awaiting_user_id from games where id = $1`, [gameId]);
  assert.deepEqual(game, { version: 3, last_seq: 4, awaiting_user_id: b });
  assert.equal((await one(`select count(*)::int as n from game_events where game_id = $1`, [gameId])).n, 4);
  // Mesmo que algo tente, a sequência de eventos não aceita duplicatas.
  await assert.rejects(
    db.query(`select vira7_insert_events($1, $2, $3::jsonb)`, [gameId, room.id, JSON.stringify([event(4)])]),
    /game_events_game_seq_key/,
  );
});

test('fim de partida grava resultados, atualiza estatísticas e devolve a sala ao lobby', async () => {
  const [a, b] = await Promise.all([signUp('fim_a'), signUp('fim_b')]);
  const room = await createRoom(a);
  await db.query(`select vira7_join_room($1, $2)`, [room.id, b]);
  await db.query(`select vira7_add_bot($1, 'Rita', 'coruja')`, [room.id]);
  await db.query(`update room_players set is_ready = true where room_id = $1`, [room.id]);

  const finish = async (winner, loser, scores) => {
    const gameId = await startGame(room);
    const results = [
      { seat: 0, userId: winner, name: 'W', score: scores[0], placement: 1, isWinner: true, roundsPlayed: 5, bestRound: 60, flip7Count: 1, busts: 1 },
      { seat: 1, userId: loser, name: 'L', score: scores[1], placement: 2, isWinner: false, roundsPlayed: 5, bestRound: 30, flip7Count: 0, busts: 3 },
      { seat: 2, userId: null, name: 'Rita', isBot: true, score: 50, placement: 3, isWinner: false, roundsPlayed: 5 },
    ];
    const ok = await one(
      `select vira7_commit_game($1, 1, '{"round":5,"seq":9}'::jsonb, '{}'::jsonb, $2::jsonb, null, null, 'finished', $3::jsonb, $4, 'W', 'score') as ok`,
      [gameId, JSON.stringify([event(9, 'gameOver')]), JSON.stringify(results), winner],
    );
    assert.equal(ok.ok, true);
    return gameId;
  };

  const gameId = await finish(a, b, [210, 120]);
  const game = await one(`select status, winner_user_id, finish_reason, finished_at is not null as done from games where id = $1`, [gameId]);
  assert.deepEqual(game, { status: 'finished', winner_user_id: a, finish_reason: 'score', done: true });

  const roomAfter = await one(`select status, current_game_id from rooms where id = $1`, [room.id]);
  assert.deepEqual(roomAfter, { status: 'lobby', current_game_id: null });
  const ready = await rows(`select is_bot, is_ready from room_players where room_id = $1 order by seat`, [room.id]);
  assert.deepEqual(ready.map((r) => r.is_ready), [false, false, true], 'pessoas voltam a "não pronto"; CPUs seguem prontas');

  await finish(a, b, [230, 90]);
  await finish(b, a, [205, 180]);

  const stats = async (id) =>
    one(`select games_played, wins, losses, total_points::int as total_points, best_game_score, best_round_score,
                flip7_count, busts, current_streak, best_streak from player_stats where user_id = $1`, [id]);
  assert.deepEqual(await stats(a), {
    games_played: 3, wins: 2, losses: 1, total_points: 210 + 230 + 180, best_game_score: 230,
    best_round_score: 60, flip7_count: 2, busts: 5, current_streak: 0, best_streak: 2,
  });
  assert.equal((await stats(b)).current_streak, 1);
  assert.equal((await one(`select count(*)::int as n from game_results where is_bot`)).n >= 3, true);

  const top = await rows(`select username, wins, win_rate from leaderboard where username in ('fim_a', 'fim_b')`);
  assert.deepEqual(top, [
    { username: 'fim_a', wins: 2, win_rate: 67 },
    { username: 'fim_b', wins: 1, win_rate: 33 },
  ]);
});

test('RLS: participantes veem a própria sala; os demais não veem nada', async () => {
  const [a, b, intruso] = await Promise.all([signUp('rls_a'), signUp('rls_b'), signUp('rls_intruso')]);
  const room = await createRoom(a);
  await db.query(`select vira7_join_room($1, $2)`, [room.id, b]);
  const gameId = await startGame(room);
  const publicRoom = await createRoom(intruso, { visibility: 'public' });

  await as('authenticated', a, async () => {
    assert.equal((await rows(`select id from rooms where id = $1`, [room.id])).length, 1);
    assert.equal((await rows(`select id from room_players where room_id = $1`, [room.id])).length, 2);
    assert.equal((await rows(`select seq from game_events where game_id = $1`, [gameId])).length, 2);
    assert.equal((await rows(`select id from games where id = $1`, [gameId])).length, 1);
    // Salas públicas abertas aparecem na lista, mas não os participantes delas.
    assert.equal((await rows(`select id from rooms where id = $1`, [publicRoom.id])).length, 1);
    assert.equal((await rows(`select id from room_players where room_id = $1`, [publicRoom.id])).length, 0);
  });

  await as('authenticated', intruso, async () => {
    assert.equal((await rows(`select id from rooms where id = $1`, [room.id])).length, 0);
    assert.equal((await rows(`select id from room_players where room_id = $1`, [room.id])).length, 0);
    assert.equal((await rows(`select seq from game_events where game_id = $1`, [gameId])).length, 0);
    assert.equal((await rows(`select id from games where id = $1`, [gameId])).length, 0);
  });
});

test('RLS: o estado secreto e as escritas de jogo são negados aos clientes', async () => {
  const [a, b] = await Promise.all([signUp('seg_a'), signUp('seg_b')]);
  const room = await createRoom(a);
  await db.query(`select vira7_join_room($1, $2)`, [room.id, b]);
  const gameId = await startGame(room);
  const denied = /permission denied/;

  await as('authenticated', a, async () => {
    await assert.rejects(db.query(`select state from game_secrets where game_id = $1`, [gameId]), denied);
    await assert.rejects(db.query(`select * from player_presence`), denied);
    await assert.rejects(db.query(`update games set public_state = '{}'::jsonb where id = $1`, [gameId]), denied);
    await assert.rejects(db.query(`insert into game_events (game_id, room_id, seq, type, state) values ($1, $2, 99, 'x', '{}')`, [gameId, room.id]), denied);
    await assert.rejects(db.query(`update rooms set host_id = $1 where id = $2`, [a, room.id]), denied);
    await assert.rejects(db.query(`update room_players set is_ready = true where room_id = $1`, [room.id]), denied);
    await assert.rejects(db.query(`update player_stats set wins = 999 where user_id = $1`, [a]), denied);
    await assert.rejects(db.query(`insert into game_results (game_id, seat, name, placement, is_winner, user_id) values ($1, 0, 'eu', 1, true, $2)`, [gameId, a]), denied);
    await assert.rejects(db.query(`select vira7_commit_game($1, 1, '{}', '{}', '[]', null, null, 'finished', '[]', $2, 'eu', 'score')`, [gameId, a]), denied);
    await assert.rejects(db.query(`select vira7_join_room($1, $2)`, [room.id, a]), denied);
  });
});

test('RLS: cada um só altera o próprio perfil e as próprias preferências', async () => {
  const [a, b] = await Promise.all([signUp('perfil_a'), signUp('perfil_b')]);

  await as('authenticated', a, async () => {
    await db.query(`update profiles set avatar = 'sapo' where id = $1`, [a]);
    const other = await db.query(`update profiles set avatar = 'sapo' where id = $1`, [b]);
    assert.equal(other.affectedRows, 0, 'não altera o perfil de outra pessoa');
    await assert.rejects(db.query(`update profiles set id = $1 where id = $2`, [b, a]), /permission denied/);

    await db.query(`update user_settings set settings = '{"volume": 0.5}'::jsonb where user_id = $1`, [a]);
    assert.equal((await rows(`select user_id from user_settings`)).length, 1, 'só enxerga as próprias preferências');
    assert.equal((await rows(`select id from profiles where id = $1`, [b])).length, 1, 'perfis são públicos para quem está logado');
  });

  assert.equal((await one(`select avatar from profiles where id = $1`, [a])).avatar, 'sapo');
  assert.equal((await one(`select avatar from profiles where id = $1`, [b])).avatar, 'raposa');

  await as('anon', null, async () => {
    for (const table of ['profiles', 'rooms', 'games', 'game_events', 'player_stats', 'game_results', 'leaderboard']) {
      await assert.rejects(db.query(`select * from ${table} limit 1`), /permission denied/, table);
    }
  });
});

test('as tabelas de tempo real estão na publicação do Supabase Realtime', async () => {
  const tables = (await rows(
    `select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename`,
  )).map((r) => r.tablename);
  assert.deepEqual(tables, ['game_events', 'room_players', 'rooms']);
});
