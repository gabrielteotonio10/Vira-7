# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.
O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

> Versão 2.1.0 em preparação. Aplique a migration `0009` antes de publicar.

### Adicionado

- **Mesma tela com várias pessoas**: a mesa gira para quem vai jogar (lugar grande embaixo) com o aviso "Passe o aparelho".
- **Tutorial guiado de verdade**: mostra Vira Três com escolha de alvo, risco, ×2, Segunda Chance salvando um estouro, penalidade, bônus e parar; só o botão indicado responde, e as animações correm mais rápido. Abre também sem conta.
- Perfil dos amigos (botão "Ver perfil") e botão de amizade no perfil de qualquer jogador.
- Título da aba pisca "● Sua vez!" quando a partida está em segundo plano.
- **Duplas 2x2** (4, 6 ou 8 jogadores): parceiros em assentos opostos, pontos somados, vitória por dupla.
- **Amigos**: pedidos por nome de usuário, lista com a sala de cada amigo (entrar ou assistir), convite por WhatsApp e **ranking só entre amigos**.
- **Espectadores**: sala cheia ou em andamento vira "assistir"; na próxima partida a pessoa assume a vaga livre.
- **Conversa rápida** (frases prontas e emojis que sobem pela mesa) e **revanche com um toque**.
- **App instalável (PWA)**: manifesto, service worker, ícones e botão de instalar nos Ajustes.
- **Vibração**, **modo mãos livres** (voz) e **modo para daltônicos**.
- **Tema escuro** (o claro continua o padrão), 4 mesas e 4 versos de carta.
- **Inglês e espanhol** (`tools/i18n-table.py` gera os dicionários).
- **Tutorial interativo** opcional (Ajustes, Como jogar e início).
- Confirmação antes de **sair da conta**.
- Migration `0009` (amigos, espectadores, duplas).
- **Cartas de penalidade**: uma −6, duas −4 e duas −2. O baralho passa de 94 para 99 cartas. O ×2 não dobra penalidades e a pontuação da rodada nunca fica abaixo de 0. Partidas já em andamento continuam com o baralho antigo (`deckVersion`).
- **Seta de voltar** na barra de navegação (e na mesa, no lugar do ícone de casa). Na sala ela pede confirmação antes de sair.
- Limpeza automática de salas abandonadas (`STALE_ROOM_SECONDS`, padrão 180 s): sem sinal de ninguém, a sala é fechada e a partida em andamento termina sem vencedor e sem pontuar.
- Hospedagem gratuita no Render: blueprint `render.yaml` (API e página no mesmo endereço) e guia passo a passo em `docs/HOSPEDAGEM.md`.

### Alterado

- **Preferências**: gravadas na hora neste aparelho e enviadas à conta; nada se perde ao sair da tela ou fechar a página (antes uma mudança feita segundos antes de sair podia sumir).
- **Modo escuro** revisado: peças de cor viva mantêm tinta escura, opções escolhidas em amarelo, campos e links legíveis.
- **Salas públicas**: a lista mostra até 10 salas sorteadas (com vaga primeiro).
- **Desempenho**: respostas compactadas (gzip), sala atual em uma consulta, salas dos amigos em lote (em vez de duas consultas por amigo).
- **Segurança**: ids vindos da URL só chegam ao banco se forem UUIDs (impede manipular filtros do PostgREST), limite de pedidos de amizade e de mensagens, cabeçalhos COOP e HSTS (produção) e CSP com worker/manifest.
- **Ranking responsivo**: no celular cada jogador vira um cartão (a tabela de 7 colunas ficava cortada).
- O anfitrião que sai do lobby **fecha a sala** para todos (antes a sala passava para outra pessoa e ficava esperando).
- Em produção (`APP_ENV=production`) a documentação interativa da API fica desligada.
- `/api/health` e a página inicial também respondem a HEAD, para monitores de disponibilidade gratuitos.

## [2.0.0] - 2026-11-16

### Adicionado

- **Multiplayer online em tempo real**: partidas entre jogadores em lugares diferentes, com cartas, jogadas, turnos e pontos sincronizados pelo Supabase Realtime.
- **Backend em Python (FastAPI)** com o motor de regras no servidor: o cliente envia apenas a intenção e o servidor valida e decide o resultado.
- **Contas com Supabase Auth**: cadastro, login, confirmação de e-mail e recuperação de senha.
- **Perfis**: nome de usuário, 10 personagens (bichinhos), estatísticas, histórico de partidas e ranking.
- **Salas**: privadas por código de convite, públicas com lista ao vivo e partida rápida.
- **Lobby** com participantes, indicação de pronto e de conexão, CPUs, expulsão e regras editáveis pelo anfitrião.
- **Regras configuráveis**: meta de 50 a 500 pontos, 2 a 8 jogadores e tempo por jogada.
- **Tempo de turno e desconexões**: árbitro no servidor joga por quem estourou o tempo ou perdeu a conexão; reconexão no meio da partida; abandono e vitória por abandono.
- **Banco de dados**: 8 migrations com tabelas, índices, funções atômicas, triggers, RLS e publicação do Realtime, em `database/migrations/`.
- **Segurança**: validação do token em todas as rotas, RLS em todas as tabelas, estado secreto da partida inacessível aos clientes e controle de concorrência por versão.
- Telas de entrar, criar conta, recuperar senha, início, sala, perfil, histórico, ranking e ajustes (áudio, velocidade, movimento reduzido, medidor de risco).
- Testes do motor Python, da API, da autenticação e do multiplayer (pytest) e das migrations em um PostgreSQL embutido (PGlite).
- Script `migrate.py` para aplicar as migrations e `smoke_online.py` para verificar tudo contra o Supabase real.
- Modo de desenvolvimento local da API (sem Supabase), com banco em memória.
- Limite de requisições por IP e por usuário (`RATE_LIMIT_ENABLED`, `TRUST_PROXY`) e cabeçalhos de segurança, com Content-Security-Policy na página.
- Testes do acesso ao Supabase com servidor simulado, do limite de requisições e dos cabeçalhos.

### Alterado

- **Nova mesa**: baralho no centro, adversários em arco e o jogador embaixo, sobre um feltro verde oval que cabe inteiro em notebooks e rola no celular mantendo o seu lugar à vista.
- **Nova identidade visual**: papel creme, contorno de tinta, cores chapadas e sombras duras (sem degradês nem vidro), fontes Lilita One e Figtree, cartas e anúncios redesenhados, tela de entrada em duas colunas e personagens no lugar das iniciais em toda a interface.
- Doca compacta no celular e relógio de turno limitado ao tempo da sala.
- Texto escuro sobre verde nos botões e selos, para contraste de leitura.
- As animações não travam mais quando a aba fica em segundo plano.
- A partida na mesma tela continua disponível em `#/local`, agora com escolha de personagem.
- O frontend passa a ser servido pela API; `scripts/serve.js` foi removido.

## [1.1.0] - 2026-11-15

### Alterado

- Removida a pilha de descarte: a mesa mostra apenas o monte de compra.
- No início de cada nova rodada, todas as 94 cartas voltam ao monte e são reembaralhadas, com animação de embaralhar e contador voltando a 94.
- Se o monte acabar no meio da rodada, as cartas já usadas são reembaralhadas no monte.
- Cartas que saem de jogo (repetida e Segunda Chance usadas) agora encolhem e somem no próprio lugar, e as cartas da mesa voltam voando para o monte no fim da rodada.
- Doca reorganizada para um único monte, também no celular.

## [1.0.0] - 2026-11-15

### Adicionado

- Motor de regras completo do Flip 7: baralho de 94 cartas, rodadas, turnos, distribuição inicial, rodízio do carteador e reembaralhamento do descarte.
- Cartas de ação Congelar, Vira Três (com ações guardadas para depois) e Segunda Chance (com repasse obrigatório da segunda cópia).
- Pontuação oficial com modificador ×2, bônus +2 a +10 e bônus de 15 pontos do Vira 7.
- Condição de vitória com meta configurável (100, 200 ou 300) e rodada extra em caso de empate.
- Jogadores controlados pelo computador com personalidades de risco diferentes.
- Tela inicial com leque de cartas animado, até 8 jogadores, escolha de cores, meta e velocidade.
- Mesa com lugares dos jogadores, marcadores do Vira 7, barra de progresso até a meta e carimbos de estado.
- Doca com montes de compra e descarte, jogador da vez, medidor de risco exato e botões Virar/Parar.
- Animações de cartas voando com giro 3D, partículas, confete, neve, anúncios e textos flutuantes.
- Efeitos sonoros sintetizados com Web Audio API, com opção de silenciar.
- Janelas de regras, resumo animado da rodada e fim de jogo com pódio e tabela de pontos.
- Histórico de jogadas, avisos rápidos, atalhos de teclado e suporte a movimento reduzido.
- Layout responsivo para celular, tablet e desktop.
- Testes automatizados do motor com `node --test` e servidor de desenvolvimento sem dependências.
