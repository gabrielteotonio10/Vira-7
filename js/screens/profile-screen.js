/**
 * Vira-7 — Perfil (próprio e de outros jogadores), histórico de partidas e ranking.
 */
((F7) => {
  'use strict';

  const { h, clear } = F7.dom;
  const { icon } = F7.icons;
  const App = F7.App;

  const statCard = (value, label, accent) =>
    h('div', { class: 'stat-card', style: accent ? { '--accent': accent } : undefined }, h('strong', {}, String(value)), h('span', {}, label));

  function statsGrid(stats) {
    return h(
      'div',
      { class: 'stat-grid' },
      statCard(stats.gamesPlayed, 'Partidas', '#4dabf7'),
      statCard(stats.wins, 'Vitórias', '#51cf66'),
      statCard(stats.losses, 'Derrotas', '#ff6b6b'),
      statCard(`${stats.winRate}%`, 'Aproveitamento', '#ffd43b'),
      statCard(stats.totalPoints, 'Pontos acumulados', '#b197fc'),
      statCard(stats.averageScore, 'Média por partida', '#22d3c5'),
      statCard(stats.bestGameScore, 'Melhor partida', '#ffa94d'),
      statCard(stats.bestRoundScore, 'Melhor rodada', '#f783ac'),
      statCard(stats.flip7Count, 'Vira 7 feitos', '#ffd43b'),
      statCard(stats.busts, 'Estouros', '#ff6b6b'),
      statCard(stats.bestStreak, 'Maior sequência', '#51cf66'),
      statCard(stats.currentStreak, 'Sequência atual', '#4dabf7'),
    );
  }

  function matchCard(match) {
    const won = match.me.isWinner;
    const reason = match.finishReason === 'forfeit' ? ' · por abandono' : '';
    return h(
      'li',
      { class: `match ${won ? 'is-win' : 'is-loss'}` },
      h(
        'div',
        { class: 'match__result' },
        h('span', { class: 'match__badge' }, won ? 'Vitória' : match.me.forfeited ? 'Abandonou' : 'Derrota'),
        h('strong', {}, `${match.me.placement}º lugar`),
        h('span', {}, `${match.me.score} pts`),
      ),
      h(
        'div',
        { class: 'match__main' },
        h('div', { class: 'match__meta' }, `${App.formatDate(match.finishedAt)} · meta ${match.targetScore} · ${match.rounds} rodadas${reason}`),
        h(
          'ol',
          { class: 'match__players' },
          match.players.map((p) =>
            h(
              'li',
              { class: p.isWinner ? 'is-winner' : '' },
              p.isWinner ? h('span', { html: icon('crown') }) : null,
              h('span', { class: 'match__name' }, p.name, p.isBot ? ' (CPU)' : '', p.userId && p.userId === F7.Auth.user.id ? ' (você)' : '', p.forfeited ? ' · saiu' : ''),
              h('b', {}, String(p.score)),
            ),
          ),
        ),
      ),
      h(
        'div',
        { class: 'match__extras' },
        match.me.flip7Count ? h('span', { class: 'chip' }, `${match.me.flip7Count}× Vira 7`) : null,
        h('span', { class: 'chip' }, `melhor rodada ${match.me.bestRound}`),
      ),
    );
  }

  /* ------------------------------------------------------------------ perfil */

  async function profile({ username } = {}) {
    App.render(App.loading());
    const own = !username || username.toLowerCase() === App.state.me.profile.username.toLowerCase();

    let data;
    if (own) {
      const me = await App.refreshMe();
      const recent = await F7.Api.get('/me/matches?limit=5');
      data = { profile: me.profile, stats: me.stats, recentMatches: recent.matches };
    } else {
      try {
        data = await F7.Api.get(`/profiles/${encodeURIComponent(username)}`);
      } catch (error) {
        App.render(App.empty('user', 'Jogador não encontrado', error.message));
        return;
      }
    }

    const info = data.profile;
    App.render(
      h(
        'div',
        { class: 'profile' },
        h(
          'section',
          { class: 'panel profile__head' },
          F7.Avatars.create({ avatar: info.avatar, name: info.username }, 'avatar--hero'),
          h(
            'div',
            { class: 'profile__id' },
            h('h1', {}, info.username),
            h('p', {}, `${F7.Avatars.info(info.avatar).name} · no jogo desde ${new Date(info.createdAt).toLocaleDateString(F7.i18n.locale, { month: 'long', year: 'numeric' })}`),
            own ? h('p', { class: 'profile__email' }, F7.Auth.user.email || '') : null,
          ),
          own
            ? h(
                'div',
                { class: 'profile__actions' },
                h('button', { type: 'button', class: 'btn btn--primary', onClick: () => editProfile(info) }, 'Editar perfil'),
                h('button', { type: 'button', class: 'btn btn--ghost', onClick: () => App.signOut() }, 'Sair da conta'),
              )
            : null,
        ),
        h('section', { class: 'panel' }, h('div', { class: 'section-head' }, h('h2', {}, 'Estatísticas')), statsGrid(data.stats)),
        h(
          'section',
          { class: 'panel' },
          h(
            'div',
            { class: 'section-head' },
            h('h2', {}, 'Últimas partidas'),
            own ? h('a', { class: 'btn btn--ghost', href: '#/historico' }, 'Ver tudo') : null,
          ),
          data.recentMatches.length
            ? h('ul', { class: 'match-list' }, data.recentMatches.map(matchCard))
            : App.empty('history', 'Nenhuma partida ainda', own ? 'Suas partidas online aparecem aqui.' : null),
        ),
      ),
    );
  }

  async function editProfile(info) {
    const { field } = F7.Screens;
    const username = field('Nome de usuário', { type: 'text', maxlength: 20, value: info.username }, '3 a 20 letras, números ou _');
    const picker = F7.Avatars.picker({ value: info.avatar });
    const ok = await F7.Modals.open({
      title: 'Editar perfil',
      eyebrow: 'Sua conta',
      body: h('div', { class: 'form' }, username.el, h('div', { class: 'form__field' }, h('span', { class: 'form__label' }, 'Personagem'), picker.el)),
      actions: [
        { label: 'Cancelar', value: false, variant: 'ghost' },
        { label: 'Salvar', value: true, variant: 'primary' },
      ],
    }).result;
    if (!ok) return;
    try {
      await F7.Api.patch('/me', { username: username.input.value.trim(), avatar: picker.value });
      App.toast('Perfil atualizado!', { variant: 'stay' });
      await profile();
    } catch (error) {
      App.toast(error.message, { variant: 'bust' });
    }
  }

  /* ------------------------------------------------------------------ histórico */

  async function history() {
    const PAGE = 10;
    const list = h('ul', { class: 'match-list' });
    const more = h('button', { type: 'button', class: 'btn btn--ghost btn--block', hidden: true }, 'Carregar mais');
    let offset = 0;

    App.render(
      h(
        'div',
        { class: 'profile' },
        h('section', { class: 'panel' }, h('div', { class: 'section-head' }, h('h1', {}, 'Histórico de partidas')), list, more),
      ),
    );

    async function load() {
      const loading = App.loading();
      list.after(loading);
      try {
        const data = await F7.Api.get(`/me/matches?limit=${PAGE}&offset=${offset}`);
        data.matches.forEach((match) => list.appendChild(matchCard(match)));
        offset += data.matches.length;
        more.hidden = !data.hasMore;
        if (!offset) {
          clear(list).appendChild(h('li', {}, App.empty('history', 'Nenhuma partida ainda', 'Jogue uma partida online e ela aparece aqui.')));
        }
      } catch (error) {
        App.toast(error.message, { variant: 'bust' });
      } finally {
        loading.remove();
      }
    }

    more.addEventListener('click', () => App.busy(more, load));
    await load();
  }

  /* ------------------------------------------------------------------ ranking */

  async function ranking({ scope = 'all' } = {}) {
    App.render(App.loading());
    const { players } = await F7.Api.get(`/leaderboard?limit=50&scope=${scope}`);
    const myId = F7.Auth.user.id;

    const tabs = h(
      'div',
      { class: 'segmented ranking-tabs', role: 'tablist' },
      [['all', 'Geral'], ['friends', 'Só amigos']].map(([value, label]) =>
        h('button', { type: 'button', role: 'tab', 'aria-selected': String(scope === value), 'aria-checked': String(scope === value), onClick: () => ranking({ scope: value }) }, label),
      ),
    );

    const position = (p) => (p.position <= 3 ? h('span', { class: `medal medal--${p.position}` }, String(p.position)) : String(p.position));
    const playerLink = (p) =>
      h('a', { class: 'ranking__player', href: `#/perfil/${encodeURIComponent(p.username)}` },
        F7.Avatars.create({ avatar: p.avatar, name: p.username }), h('b', {}, p.username));

    // No celular a tabela de 7 colunas não cabe: cada jogador vira um cartão.
    const cards = h(
      'ol',
      { class: 'rank-list' },
      players.map((p) =>
        h(
          'li',
          { class: `rank-card${p.userId === myId ? ' is-me' : ''}` },
          h('span', { class: 'rank-card__pos' }, position(p)),
          h('div', { class: 'rank-card__who' }, playerLink(p)),
          h('div', { class: 'rank-card__wins' }, h('b', {}, String(p.wins)), h('small', {}, p.wins === 1 ? 'vitória' : 'vitórias')),
          h(
            'dl',
            { class: 'rank-card__stats' },
            [['Partidas', p.gamesPlayed], ['Aproveit.', `${p.winRate}%`], ['Pontos', p.totalPoints], ['Vira 7', p.flip7Count]].map(([label, value]) =>
              h('div', {}, h('dt', {}, label), h('dd', {}, String(value))),
            ),
          ),
        ),
      ),
    );

    const body = players.length
      ? h('div', { class: 'ranking-view' }, cards, h(
          'div',
          { class: 'final-table__wrap ranking-table' },
          h(
            'table',
            { class: 'final-table ranking' },
            h('thead', {}, h('tr', {}, ['#', 'Jogador', 'Vitórias', 'Partidas', '%', 'Pontos', 'Vira 7'].map((t) => h('th', { scope: 'col' }, t)))),
            h(
              'tbody',
              {},
              players.map((p) =>
                h(
                  'tr',
                  { class: p.userId === myId ? 'is-me' : '' },
                  h('td', {}, position(p)),
                  h('td', {}, playerLink(p)),
                  h('td', {}, String(p.wins)),
                  h('td', {}, String(p.gamesPlayed)),
                  h('td', {}, `${p.winRate}%`),
                  h('td', {}, String(p.totalPoints)),
                  h('td', {}, String(p.flip7Count)),
                ),
              ),
            ),
          ),
        ))
      : scope === 'friends'
        ? App.empty('users', 'Nenhum amigo no ranking ainda', 'Adicione amigos na aba Amigos. Quem já terminou uma partida aparece aqui.')
        : App.empty('trophy', 'O ranking ainda está vazio', 'Termine uma partida online para aparecer aqui.');

    App.render(h('div', { class: 'profile' }, h('section', { class: 'panel' }, h('div', { class: 'section-head' }, h('h1', {}, 'Ranking')), tabs, body)));
  }

  F7.Screens = Object.assign(F7.Screens || {}, { profile, history, ranking });
})(globalThis.F7 = globalThis.F7 || {});
