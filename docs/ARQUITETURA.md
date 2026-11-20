# Arquitetura do Vira-7

## Visão geral

```
 Navegador (HTML/CSS/JS)                API (FastAPI, Python)                 Supabase
┌────────────────────────┐   HTTPS    ┌───────────────────────┐   REST/RPC  ┌──────────────────┐
│ Telas e mesa           │──────────▶│ Valida o token (JWT)  │────────────▶│ PostgreSQL       │
│ Envia INTENÇÕES:       │  /api/...  │ Aplica as regras      │ service role│  tabelas + RLS   │
│  virar, parar, alvo    │◀──────────│ Grava de forma atômica│◀────────────│  funções vira7_* │
│                        │            │ Árbitro de turnos     │             │  triggers        │
│ supabase-js            │            └───────────────────────┘             │                  │
│  ├─ Auth: login ───────┼─────────────────────────────────────────────────▶│ Auth             │
│  └─ Realtime ◀─────────┼──────── eventos da partida, lobby, presença ─────│ Realtime         │
└────────────────────────┘                                                  └──────────────────┘
```

Três responsabilidades bem separadas:

- **Supabase Auth** cuida das contas. O navegador faz login direto nele e recebe um token de acesso.
- **A API** é a única que escreve dados de jogo. Ela confere o token, aplica as regras e grava no banco com a chave `service_role`, que existe só no servidor.
- **Supabase Realtime** entrega as mudanças do banco aos navegadores. O cliente só lê — e só o que as políticas de RLS permitem.

## O servidor decide tudo

O cliente nunca informa o resultado de nada. Ele manda apenas `{type: "hit" | "stay" | "target", target?, token}` e o servidor responde com o que aconteceu.

O motor de regras do servidor fica em `backend/app/game/`:

| Arquivo | Papel |
| --- | --- |
| `cards.py` | As 99 cartas (94 na versão 1 do baralho, que partidas antigas ainda usam) e o embaralhamento a partir de uma semente. |
| `scoring.py` | Pontuação oficial e condição de vitória. |
| `engine.py` | Uma rodada: distribuição, turnos, estouro, Congelar, Vira Três, Segunda Chance, Vira 7. |
| `ai.py` | Decisões das CPUs e a jogada automática de quem estourou o tempo. |
| `session.py` | A partida inteira: várias rodadas, vitória, abandono, eventos e persistência. |

Ele é uma tradução fiel do motor JavaScript do modo local (`js/core/`). Os dois foram comparados em 400 rodadas com as mesmas cartas e deram resultados idênticos.

### Como a partida sobrevive entre requisições

A API não guarda nada em memória entre uma requisição e outra. O estado privado de cada partida fica na tabela `game_secrets` e contém a **semente** do embaralhamento da rodada e a **lista de decisões** já tomadas. A cada jogada o servidor:

1. lê a partida e reconstrói o motor refazendo a rodada com as decisões gravadas (é determinístico);
2. aplica a nova decisão — o motor recusa jogada fora da vez, alvo inválido ou repetida;
3. roda sozinho até precisar de outra decisão humana (as CPUs decidem na hora);
4. grava tudo em **uma transação**.

O teste `test_recarregar_a_cada_jogada_da_o_mesmo_resultado_que_jogar_direto` garante que reconstruir a cada passo dá exatamente o mesmo jogo.

### Jogadas simultâneas

Cada partida tem uma coluna `version`. A função `vira7_commit_game` só grava se a versão ainda for a que a API leu:

```sql
update games set version = version + 1, ... where id = $1 and version = $2 and status = 'playing'
```

Se duas jogadas chegam juntas, a primeira grava e a segunda não encontra a versão; a API então recarrega e valida de novo, e o motor a recusa. Além disso, cada decisão pendente tem um `token`, então um clique duplo não vira duas jogadas, e `game_events` tem índice único em `(game_id, seq)`.

Como a proteção está no banco, vários processos da API podem rodar ao mesmo tempo.

## Sincronização em tempo real

Cada jogada aceita gera **eventos** (`cardDrawn`, `bust`, `freeze`, `flip7`, `roundEnd`…) gravados em `game_events`, com um número de sequência e um retrato público da mesa depois do evento.

Os navegadores recebem esses eventos de três jeitos, e descartam os repetidos pelo número de sequência:

1. **Supabase Realtime** (Postgres Changes em `game_events`): o caminho normal, para todos os jogadores.
2. **Resposta da própria jogada**: quem jogou vê o resultado na hora.
3. **Consulta periódica** (`GET /api/games/{id}/events?after=N`): rede de segurança se o tempo real cair, e para preencher lacunas.

O cliente (`js/online/online-match.js`) coloca os eventos em fila e anima um por vez, reaproveitando o mesmo código de animação do modo local. Se acumular muita coisa (aba em segundo plano, reconexão), ele acelera para alcançar.

O lobby usa o mesmo canal: mudanças em `rooms` e `room_players` avisam a tela para recarregar a sala, e o **Presence** do Realtime mostra quem está conectado.

### Tempo de turno e desconexões

- Cada decisão pendente tem um prazo (`turn_deadline`), calculado pelo servidor somando o tempo que os clientes levam para animar os eventos.
- O cliente envia um sinal de presença a cada 10 s (`/heartbeat`).
- Um **árbitro** (`services/referee.py`) roda em segundo plano na API: se o prazo venceu ou o jogador da vez está sem sinal há mais de 40 s, o servidor joga por ele (para, ou escolhe o alvo). Qualquer cliente também pode pedir essa conferência (`/tick`); o servidor só age se for verdade.
- Quem volta reencontra a sala e a partida pelo `GET /api/me` e retoma do ponto atual.
- O **anfitrião que sai do lobby** fecha a sala para todos. E a cada ~30 s o árbitro fecha as salas em que ninguém dá sinal há `STALE_ROOM_SECONDS` (partidas assim terminam como `abandoned`, sem vencedor e sem estatísticas).
- **Duplas**: `rooms.team_mode`. A dupla é decidida pela posição na mesa (`scoring.team_of`: assentos opostos). A vitória e os resultados usam a soma da dupla; as duas pessoas são marcadas como vencedoras.
- **Espectadores**: quem entra numa sala cheia ou em andamento vira espectador (`room_spectators`). Ele lê a sala, a partida e o chat, mas qualquer jogada é recusada (`NOT_IN_GAME`). Quando a sala volta ao lobby, o servidor promove os espectadores aos assentos livres (do mais antigo ao mais novo).
- **Chat rápido** (`services/chat.py`): só chaves de uma lista fixa (frases e emojis), guardadas na memória do processo (últimas 60 por sala). O cliente consulta a cada 2,5 s. Com mais de uma instância da API, o chat só enxerga a própria instância.
- **Amigos** (`services/friends.py`): pedido cruzado vira amizade; a lista mostra a sala de cada amigo para entrar ou assistir. O ranking de amigos filtra o ranking geral.
- Quem **sai** da sala durante a partida a abandona: fica fora das próximas rodadas. Se sobrar uma pessoa só, ela vence; se não sobrar ninguém, a partida é encerrada.

## Segurança e desempenho (2.1)

- Ids recebidos pela URL (`/friends/{id}`, `/games/{id}`, jogadores) passam por `is_uuid` antes de entrar em qualquer filtro do PostgREST; um id forjado vira "não encontrado".
- Limites por usuário: criar sala (20/min), pedidos de amizade (20/min), chat (40/min, e 1 mensagem a cada 0,8 s).
- Cabeçalhos: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` (microfone só para a própria página), `Cross-Origin-Opener-Policy` e, em produção, `Strict-Transport-Security`.
- Respostas acima de 800 bytes saem compactadas (gzip). `active_membership` usa uma consulta com a sala embutida; a lista de amigos busca as salas de todos em uma consulta.
- A lista pública mostra até 10 salas sorteadas entre as abertas.
- Preferências: `App.saveSettings` grava no aparelho (com `updatedAt`) e na conta; a versão mais nova vence ao abrir o jogo.

### Ajustes da 2.1 (revisão profissional)

- **Duplas**: o assento define a dupla (`team_of(seat, n) = seat % (n // 2)`); a CPU nunca congela nem vira três no parceiro e doa a Segunda Chance a ele. Quem desiste leva a dupla à derrota só se não sobrar nenhuma pessoa da dupla; se só restar uma dupla, ela vence por abandono. O servidor só aceita 4, 6 ou 8 jogadores com duplas.
- **Distribuição inicial**: o motor guarda quem já recebeu a carta inicial (`dealt`), então uma Segunda Chance doada durante a distribuição não faz ninguém ser pulado.
- **Salas privadas**: `list_open_rooms` só devolve salas públicas; amigos só veem o código de uma sala privada se o anfitrião ativou "amigos entram direto".
- **Anfitrião ausente**: o árbitro passa o lobby para outra pessoa quando o anfitrião fica sem sinal por `HOST_AWAY_SECONDS`.
- **Poda**: o árbitro apaga eventos e segredos de partidas terminadas há mais de `PRUNE_GAMES_DAYS` dias (as estatísticas e o histórico ficam).
- **Convidado e Google**: login anônimo e OAuth do Supabase, ligados por `GUEST_LOGIN`/`GOOGLE_LOGIN` e anunciados em `/api/config`. O convidado vira conta normal com `auth.updateUser`.
- **Conquistas**: calculadas a partir das estatísticas (`services/profiles.ACHIEVEMENTS`), sem tabela nova. Os prêmios do fim da partida são calculados no cliente com o que a mesa mostrou.
- **Frontend sem CDN**: fontes (`assets/fonts`) e `supabase-js` (`assets/vendor`) são servidos pela própria API, e a CSP não libera domínios externos.

## Frontend: preferências, idiomas e app instalável

- `js/app/theme.js` marca `<html>` com `data-theme`, `data-table`, `data-back` e `data-cb` (veja `css/themes.css`). A escolha também fica no `localStorage` para valer antes do login.
- `js/fx/haptics.js` liga cada som do jogo a um padrão de vibração. `js/app/voice.js` narra a mesa e escuta "virar"/"parar" (Web Speech API, quando existe).
- `js/app/i18n.js` traduz o que aparece na página (texto e atributos) a partir de dicionários em `js/i18n/`. O texto-fonte é o português; o que não estiver no dicionário continua em português. Para traduzir algo novo, edite `tools/i18n-table.py` e rode `python tools/i18n-table.py`.
- `sw.js` + `manifest.webmanifest` (servidos na raiz pela API) fazem o app instalável. O service worker nunca guarda respostas de `/api`.

## Banco de dados

| Tabela | Conteúdo | Quem lê pelo cliente |
| --- | --- | --- |
| `profiles` | Nome de usuário e personagem | Qualquer pessoa logada |
| `user_settings` | Preferências (áudio, animações) | Só o dono |
| `player_stats` | Vitórias, pontos, sequências… | Qualquer pessoa logada |
| `rooms` | Salas e suas regras | Membros; públicas abertas para todos |
| `room_players` | Participantes, assentos, prontos | Membros da sala |
| `player_presence` | Último sinal de cada jogador | Ninguém (só o servidor) |
| `games` | Partida e retrato público | Membros da sala |
| `game_secrets` | Semente e decisões (ordem do monte) | **Ninguém** (só o servidor) |
| `game_events` | Eventos em ordem | Membros da sala |
| `game_results` | Placar final por jogador | Qualquer pessoa logada |
| `friendships` | Pedidos de amizade e amigos | Só as duas pessoas |
| `room_spectators` | Quem assiste a uma sala | **Ninguém** (só o servidor; a RLS das salas e partidas os reconhece) |

Funções e triggers:

- `handle_new_user` — ao cadastrar, cria perfil, preferências e estatísticas.
- `vira7_create_room`, `vira7_join_room`, `vira7_add_bot`, `vira7_leave_room` — travam a sala para nunca passar da lotação nem repetir assento; trocam o anfitrião e fecham salas vazias.
- `vira7_start_game` — só inicia se a sala está no lobby e a lista de jogadores não mudou.
- `vira7_commit_game` — grava a jogada com conferência de versão; no fim, grava resultados e devolve a sala ao lobby.
- `apply_game_result` — trigger que atualiza as estatísticas quando um resultado é gravado.

Índices únicos reforçam as regras: uma pessoa em **uma sala por vez**, **uma partida em andamento por sala**, um assento por participante.

## Segurança

- **Tokens**: toda rota protegida valida o JWT do Supabase (assinatura, validade, audiência e papel `authenticated`). Aceita chaves assimétricas (JWKS) e o segredo legado HS256.
- **RLS em todas as tabelas**. Os clientes não têm permissão de escrita em salas, partidas, eventos, resultados nem estatísticas; as funções `vira7_*` só podem ser executadas pela `service_role`.
- **Segredos**: `game_secrets` não tem política nenhuma — nem os participantes conseguem ler. O retrato público nunca inclui a ordem do monte.
- **Credenciais**: só em variáveis de ambiente. A API serve apenas `index.html`, `css/`, `js/` e `assets/`; nada de `backend/`.
- **Limite de requisições** (`app/ratelimit.py`): janela deslizante por IP em todas as rotas de `/api` (login local 10/min, consulta de nome 40/min, escritas 400/min, leituras 1500/min) e por usuário autenticado (900/min no total, 20/min para criar sala). Responde `429` com `Retry-After`. Atrás de um proxy, ligue `TRUST_PROXY` para usar o IP real; sem isso o cabeçalho `X-Forwarded-For` é ignorado, para ninguém escapar do limite forjando-o. Cada processo conta separadamente.
- **Cabeçalhos de segurança**: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` e `Permissions-Policy` em todas as respostas. A página leva uma Content-Security-Policy que só permite o próprio site, o script do Supabase (CDN), as fontes do Google e a conexão (HTTPS e WebSocket) com o projeto Supabase configurado; não há script inline.
- **Busca por nome de usuário**: os curingas do `ilike` (`_`, `%`, `*`) são escapados, para `gabriel_7` não casar com `gabrielx7`, e só nomes válidos chegam ao banco.
- **Erros**: respostas de erro têm código e mensagem para o usuário, sem detalhes internos.

## Frontend

Sem build: scripts clássicos que compartilham o namespace `F7`.

- `js/app/` — `api.js` (requisições com token), `auth.js` (Supabase Auth), `realtime.js` (canal da sala), `app.js` (rotas por hash, navegação, avisos, preferências).
- `js/screens/` — uma função por tela.
- `js/ui/` e `js/fx/` — mesa, cartas, personagens, HUD, janelas, animações e sons. São os mesmos nos modos local e online: o modo online entrega à interface um "espelho" do estado do servidor com o mesmo formato do motor local.

## API

Todas as rotas ficam em `/api` (documentação interativa em `/api/docs`).

| Método e rota | Uso |
| --- | --- |
| `GET /health`, `GET /config` | Estado da API e configuração pública do frontend |
| `GET /usernames/{nome}/available` | Disponibilidade do nome de usuário |
| `GET /me`, `PATCH /me`, `PUT /me/settings` | Perfil, estatísticas, preferências e sala atual |
| `GET /me/matches`, `GET /profiles/{nome}`, `GET /leaderboard` | Histórico, perfil público e ranking |
| `GET /rooms/public`, `POST /rooms`, `POST /rooms/quick` | Lista, criação e partida rápida |
| `POST /rooms/{código}/join` · `leave` · `ready` · `start` · `heartbeat` · `bots` | Lobby |
| `GET`/`PATCH /rooms/{código}`, `DELETE /rooms/{código}/players/{id}` | Detalhe, regras e remoção |
| `GET /games/{id}`, `GET /games/{id}/events` | Retrato e eventos da partida |
| `POST /games/{id}/actions`, `POST /games/{id}/tick` | Jogada e conferência de prazo |
