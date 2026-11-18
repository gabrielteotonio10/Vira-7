# Vira-7

Jogo de cartas online de risco e estratégia, fiel às regras do **Flip 7**. A cada turno você decide entre **virar** mais uma carta para somar pontos ou **parar** para garantir o que já tem — se virar um número repetido, perde tudo da rodada.

Jogue com amigos em qualquer lugar (salas privadas por código ou salas públicas), com conta, perfil, estatísticas e histórico. Também dá para jogar na mesma tela, sem conta.

| Parte | Tecnologia |
| --- | --- |
| Frontend | HTML, CSS e JavaScript puros (sem build) |
| Backend | Python + FastAPI |
| Banco, contas e tempo real | Supabase (PostgreSQL, Auth e Realtime) |

## O que tem

- **Multiplayer em tempo real**: cartas, jogadas, turnos e pontos sincronizados entre todos os jogadores.
- **Servidor como autoridade**: o cliente só envia a intenção (virar, parar, alvo). As regras rodam no servidor e a ordem do monte nunca chega ao navegador.
- **Salas**: privadas por código de convite, públicas com lista ao vivo e partida rápida.
- **Lobby**: participantes, quem está pronto, quem está conectado, CPUs para completar a mesa, expulsão e troca de regras pelo anfitrião.
- **Regras configuráveis**: meta de 50 a 500 pontos, 2 a 8 jogadores e tempo por jogada (ou sem tempo).
- **Desconexões**: quem perde a conexão ou estoura o tempo tem a jogada feita pelo servidor e pode voltar para a partida. Quem sai abandona; a partida continua para os outros.
- **Contas**: cadastro, login, confirmação de e-mail e recuperação de senha pelo Supabase Auth.
- **Perfil**: nome de usuário, 10 personagens (bichinhos), estatísticas, histórico de partidas e ranking.
- **Mesa**: baralho no centro, adversários em volta e você embaixo, com cartas voando, partículas, confete e sons sintetizados. O visual é de jogo de tabuleiro impresso: papel creme, contorno de tinta, cores chapadas e sombras duras, com as fontes Lilita One e Figtree.
- **Modo local**: várias pessoas e CPUs no mesmo aparelho, sem servidor.

## Regras do jogo

1. O carteador distribui uma carta virada para cada jogador.
2. Na sua vez: **Virar** (compra uma carta) ou **Parar** (guarda os pontos e sai da rodada).
3. Número repetido = **estouro**: 0 ponto na rodada.
4. Juntar **7 números diferentes** encerra a rodada na hora e vale **+15**.
5. A cada rodada todas as cartas voltam ao monte e são reembaralhadas (não há pilha de descarte).
6. Vence quem passar da meta (200 por padrão) com a maior pontuação. Empate na liderança = rodada extra.

| Carta | Qtd. | Efeito |
| --- | --- | --- |
| Números 0 a 12 | 79 | Valem o próprio número. O número N aparece N vezes (e há uma carta 0). |
| +2, +4, +6, +8, +10 | 5 | Somam pontos. Não contam para o Vira 7 e não estouram. |
| ×2 | 1 | Dobra a soma dos números (não dobra bônus nem o Vira 7). |
| Congelar | 3 | O alvo guarda os pontos e sai da rodada. |
| Vira Três | 3 | O alvo é obrigado a virar as próximas 3 cartas. |
| Segunda Chance | 3 | Anula um estouro. Só é possível ter uma por vez. |

Pontuação: soma dos números → ×2 → bônus → +15 do Vira 7. Exemplo: (8 + 6 + 3) × 2 + 4 = **38**.

## Como rodar

### 1. Backend (Python 3.11+)

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows  (Linux/macOS: source .venv/bin/activate)
pip install -r requirements-dev.txt
```

### 2. Supabase

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Copie `backend/.env.example` para `backend/.env` e preencha (veja a tabela abaixo).
3. Aplique as migrations:

   ```bash
   python scripts/migrate.py
   ```

   Sem acesso direto ao banco? Rode `python scripts/migrate.py --print`, copie a saída e cole no **SQL Editor** do Supabase. Os arquivos estão em [`database/migrations/`](database/migrations/) e detalhados em [`database/README.md`](database/README.md).
4. No painel do Supabase, em **Authentication → URL Configuration**, defina a **Site URL** com o endereço onde o jogo roda (em desenvolvimento, `http://localhost:8000`) e inclua o mesmo endereço em **Redirect URLs**. É para lá que vão os links de confirmação de e-mail e de recuperação de senha.

### 3. Subir

```bash
uvicorn app.main:app --port 8000
```

Abra **http://localhost:8000**. A API serve o frontend em `/` e fica em `/api` (documentação interativa em `/api/docs`).

Para conferir tudo contra o Supabase real (contas, partida completa, RLS, estatísticas), com a API rodando:

```bash
python scripts/smoke_online.py
```

### Variáveis de ambiente (`backend/.env`)

| Variável | Obrigatória | Onde achar / para que serve |
| --- | --- | --- |
| `SUPABASE_URL` | sim | Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | sim | Chave pública (anon / publishable). Vai para o navegador. |
| `SUPABASE_SERVICE_ROLE_KEY` | sim | Chave secreta (service_role / secret). **Só no servidor.** |
| `SUPABASE_JWT_SECRET` | não | Só para projetos com JWT legado (HS256). Projetos novos: deixe vazio. |
| `DATABASE_URL` | só para migrar | Connect → *Session pooler*. Usada apenas por `scripts/migrate.py`. |
| `CORS_ORIGINS` | não | Origens liberadas, se o frontend ficar em outro domínio. |
| `APP_ENV` | não | `development` ou `production`. |
| `SERVE_FRONTEND` | não | `true` (padrão): a API serve o frontend. |
| `REFEREE_ENABLED` | não | `true` (padrão): árbitro de tempo de turno e desconexões. |
| `DISCONNECT_GRACE_SECONDS` | não | Segundos sem sinal até o servidor jogar pelo jogador (padrão 40). |
| `RATE_LIMIT_ENABLED` | não | `true` (padrão): limite de requisições por IP e por usuário. |
| `TRUST_PROXY` | não | `false` (padrão). Ligue só atrás de um proxy/CDN confiável: o limite usa o IP de `X-Forwarded-For`. |

O `.env` está no `.gitignore`. A chave `service_role` e o segredo do JWT nunca são enviados ao navegador: o frontend recebe apenas a URL e a chave pública, por `/api/config`.

### Sem Supabase (só para desenvolver)

Se `SUPABASE_URL` estiver vazio, a API sobe em **modo de desenvolvimento local**: mesma API e mesmas regras, mas com banco em memória e login local (os dados somem ao reiniciar; não há e-mail de recuperação). Cada aba do navegador vira um jogador, o que facilita testar uma partida sozinho. Esse modo é recusado com `APP_ENV=production`.

### Frontend em outro domínio

Por padrão o frontend é servido pela própria API. Para hospedá-lo separado, publique `index.html`, `css/`, `js/` e `assets/`, aponte `apiUrl` em [`js/config.js`](js/config.js) para o backend e libere a origem em `CORS_ORIGINS`.

## Testes

```bash
npm install            # uma vez: instala o Postgres embutido usado nos testes do banco
npm test               # motor do jogo em JavaScript (modo local)
npm run test:db        # migrations, funções, triggers e RLS em um Postgres real embutido
npm run test:api       # motor Python, API, autenticação, limite de requisições e multiplayer (com o venv ativo)
```

| Suíte | O que cobre |
| --- | --- |
| `tests/` (Node) | Baralho, pontuação, cartas de ação e partidas completas no motor JS. |
| `database/tests/` (Node + PGlite) | As 8 migrations aplicadas duas vezes, trigger de cadastro, lotação e assentos, início único de partida, jogadas simultâneas, estatísticas e políticas de RLS. |
| `backend/tests/` (pytest) | Regras no servidor, reconstrução da partida a cada jogada, tokens inválidos, salas, partidas completas com várias pessoas, concorrência, tempo de turno, desconexão, abandono e revanche; limite de requisições e cabeçalhos de segurança; formato das chamadas ao Supabase (PostgREST) com servidor simulado. |

## Estrutura

```
├── index.html                # Página única
├── css/                      # Estilos (tokens, cartas, mesa, telas…)
├── js/
│   ├── core/                 # Motor do jogo em JS (modo local)
│   ├── fx/                   # Animações, partículas e sons
│   ├── ui/                   # Mesa, cartas, personagens, HUD, janelas
│   ├── app/                  # Cliente da API, autenticação, tempo real, rotas
│   ├── online/               # Partida online (espelho do estado do servidor)
│   └── screens/              # Entrar, início, sala, perfil, ajustes, modo local
├── backend/
│   ├── app/
│   │   ├── game/             # Motor do jogo em Python (autoridade das partidas)
│   │   ├── services/         # Salas, partidas, perfis e árbitro
│   │   ├── routers/          # Rotas HTTP
│   │   ├── store/            # Acesso a dados (Supabase e memória)
│   │   └── auth.py, config.py, errors.py, ratelimit.py, main.py
│   ├── scripts/              # migrate.py e smoke_online.py
│   └── tests/
├── database/
│   ├── migrations/           # SQL: tabelas, índices, funções, triggers, RLS, Realtime
│   └── tests/                # Testes das migrations
├── docs/ARQUITETURA.md       # Como tudo se encaixa
└── tests/                    # Testes do motor JS
```

A arquitetura completa — fluxo de uma jogada, tempo real, concorrência e segurança — está em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## Créditos

Baseado nas regras do jogo de cartas *Flip 7*, de Eric Olsen (The Op Games). Projeto de estudo, sem fins comerciais.
