# Banco de dados (Supabase / PostgreSQL)

Tudo o que o Supabase precisa está em [`migrations/`](migrations/), em arquivos numerados. Eles são **idempotentes**: podem ser executados mais de uma vez sem erro.

| Arquivo | O que cria |
| --- | --- |
| `0001_perfis.sql` | `profiles`, `user_settings`, `player_stats` e o trigger que cria o perfil no cadastro |
| `0002_salas.sql` | `rooms`, `room_players`, `player_presence` e o gerador de código de convite |
| `0003_partidas.sql` | `games`, `game_secrets`, `game_events`, `game_results` |
| `0004_estatisticas.sql` | Trigger que atualiza as estatísticas e a view `leaderboard` |
| `0005_funcoes_salas.sql` | `is_room_member` e as funções atômicas de sala (`vira7_create_room`, `vira7_join_room`…) |
| `0006_funcoes_partidas.sql` | `vira7_start_game` e `vira7_commit_game` (controle de concorrência) |
| `0007_seguranca_rls.sql` | Row Level Security, políticas e permissões de todas as tabelas e funções |
| `0008_realtime.sql` | Publica `game_events`, `room_players` e `rooms` no Supabase Realtime |

## Como aplicar

**Opção 1 — script (recomendado).** Preencha `DATABASE_URL` em `backend/.env` (Supabase → Connect → *Session pooler*) e rode:

```bash
cd backend
python scripts/migrate.py            # aplica as que faltam
python scripts/migrate.py --status   # mostra o que já foi aplicado
```

O script registra cada arquivo em `public.schema_migrations` e roda cada um em uma transação.

**Opção 2 — SQL Editor.** Sem acesso direto ao banco:

```bash
cd backend
python scripts/migrate.py --print > ../todas-as-migrations.sql
```

Cole o conteúdo no **SQL Editor** do Supabase e execute. Ou abra os arquivos de `migrations/` em ordem e execute um por um.

## Depois de aplicar

- **Authentication → URL Configuration**: defina a *Site URL* e as *Redirect URLs* com o endereço do jogo.
- **Authentication → Sign In / Providers → Email**: a confirmação de e-mail pode ficar ligada (o jogo mostra a tela "confirme seu e-mail") ou desligada.
- O Realtime já fica configurado pela migration `0008`.

## Testes

```bash
npm install
npm run test:db
```

Os testes ([`tests/migrations.test.mjs`](tests/migrations.test.mjs)) sobem um PostgreSQL real embutido (PGlite), simulam os papéis do Supabase (`anon`, `authenticated`, `service_role`) e conferem:

- as 8 migrations aplicam sem erro, duas vezes seguidas;
- o cadastro cria perfil, preferências e estatísticas, inclusive com nome repetido ou inválido;
- lotação, assentos, uma sala por pessoa, troca de anfitrião e fechamento de sala vazia;
- só uma partida começa por sala, e não se a lista de jogadores mudou;
- duas jogadas sobre a mesma versão: só a primeira é gravada;
- fim de partida grava resultados, atualiza estatísticas e o ranking, e devolve a sala ao lobby;
- RLS: participantes veem a própria sala, os demais não veem nada; o estado secreto e todas as escritas de jogo são negados aos clientes; cada um só altera o próprio perfil.

O arquivo `tests/supabase-stub.sql` existe só para esses testes. **Não o execute no Supabase.**
