# Vira-7

Um jogo de estratégia casual e tensão progressiva onde grupos de amigos ou familiares competem na mesma tela. A cada turno, o jogador decide entre **virar** uma nova carta do baralho para aumentar sua pontuação ou **parar** para salvar os pontos acumulados na rodada — correndo o risco constante de tirar um número repetido e perder tudo.

O Vira-7 é uma versão digital fiel às regras originais do jogo de cartas **Flip 7**, feita com HTML, CSS e JavaScript puros, sem dependências.

## Destaques

- **Regras completas do Flip 7**: baralho oficial de 94 cartas, cartas de ação (Congelar, Vira Três, Segunda Chance), modificadores (+2 a +10 e ×2), bônus de 15 pontos do Vira 7, rodízio do carteador, reembaralhamento do descarte e desempate.
- **De 2 a 8 jogadores** na mesma tela, misturando pessoas e CPUs com personalidades diferentes.
- **Medidor de risco em tempo real**: mostra a chance exata de estourar na próxima carta.
- **Animações fluidas**: cartas voando e girando em 3D, partículas, confete, gelo, carimbos e anúncios.
- **Sons sintetizados** com Web Audio API (nenhum arquivo de áudio).
- **Responsivo** do celular ao monitor ultralargo, com suporte a teclado e a movimento reduzido.
- **Histórico de jogadas**, resumo animado de cada rodada e pódio no fim da partida.

## Como jogar

1. O carteador distribui uma carta virada para cima para cada jogador.
2. Na sua vez, escolha **Virar** (comprar mais uma carta) ou **Parar** (guardar os pontos e sair da rodada).
3. Tirou um número que já tem na mesa? Você **estoura** e marca 0 na rodada.
4. A rodada termina quando todos param ou estouram — ou quando alguém junta **7 números diferentes** (Vira 7, +15 pontos).
5. Quem passar de **200 pontos** ao fim de uma rodada com a maior pontuação vence. Empate na liderança gera uma rodada extra.

### Cartas

| Carta | Quantidade | Efeito |
| --- | --- | --- |
| Números 0 a 12 | 79 | Valem o próprio número. O número N aparece N vezes (e há uma carta 0). |
| +2, +4, +6, +8, +10 | 5 | Somam pontos. Não contam para o Vira 7 e não estouram. |
| ×2 | 1 | Dobra a soma dos números (não dobra bônus nem o Vira 7). |
| Congelar | 3 | O alvo guarda os pontos e sai da rodada. |
| Vira Três | 3 | O alvo é obrigado a virar as próximas 3 cartas. |
| Segunda Chance | 3 | Anula um estouro. Só é possível ter uma por vez. |

**Pontuação:** soma dos números → aplica ×2 → soma os bônus → +15 se fez Vira 7.
Exemplo: (8 + 6 + 3) × 2 + 4 = **38 pontos**.

### Atalhos de teclado

| Tecla | Ação |
| --- | --- |
| `V` ou `Espaço` | Virar |
| `P` | Parar |
| `Enter` | Escolher o alvo destacado |
| `Esc` | Fechar janelas |

## Executando

O jogo não precisa de instalação nem de build: basta abrir o `index.html` em um navegador moderno.

Para desenvolvimento, com Node.js 18 ou superior:

```bash
npm start
```

O servidor sobe em `http://localhost:5173`, sem cache.

### Testes

O motor de regras tem testes automatizados com o test runner nativo do Node (sem dependências):

```bash
npm test
```

Os testes cobrem a composição do baralho, a pontuação oficial, todas as cartas de ação, a distribuição inicial, o rodízio do carteador e simulações de partidas completas entre CPUs que verificam se as 94 cartas são conservadas o tempo todo.

## Estrutura do projeto

```
├── index.html              # Página única com as duas telas (início e mesa)
├── assets/                 # Ícone do jogo
├── css/
│   ├── tokens.css          # Cores, tipografia, espaçamentos e tempos
│   ├── base.css            # Reset e estilos globais
│   ├── components.css      # Botões, chips, campos, painéis, logo
│   ├── cards.css           # Desenho das cartas
│   ├── animations.css      # Keyframes e camadas de efeitos
│   ├── layout.css          # Estrutura das telas, barra superior e doca
│   ├── setup.css           # Tela inicial
│   ├── table.css           # Lugares dos jogadores na mesa
│   ├── hud.css             # Montes, medidor de risco, botões, avisos, histórico
│   ├── modals.css          # Regras, resumo da rodada e fim de jogo
│   └── responsive.css      # Ajustes para tablet e celular
├── js/
│   ├── core/               # Regras puras (rodam no navegador e no Node)
│   │   ├── constants.js    # Composição do baralho e regras numéricas
│   │   ├── utils.js        # Embaralhamento, RNG com semente, utilidades
│   │   ├── deck.js         # Baralho, compra, descarte e reembaralhamento
│   │   ├── player.js       # Estado de cada jogador
│   │   ├── scoring.js      # Pontuação e condição de vitória
│   │   ├── game.js         # Motor assíncrono: rodadas, turnos e ações
│   │   └── ai.js           # Decisões das CPUs
│   ├── fx/
│   │   ├── effects.js      # Cartas voando, partículas, anúncios
│   │   └── sound.js        # Efeitos sonoros sintetizados
│   ├── ui/                 # Interface
│   │   ├── dom.js, icons.js, storage.js, card-view.js
│   │   ├── setup-screen.js # Configuração da partida
│   │   ├── table-view.js   # Mesa e escolha de alvos
│   │   ├── hud.js          # Doca, risco, avisos e histórico
│   │   ├── modals.js       # Janelas
│   │   └── game-controller.js # Liga o motor às animações e às jogadas
│   └── main.js             # Ponto de entrada
├── scripts/serve.js        # Servidor estático de desenvolvimento
└── tests/                  # Testes do motor (node --test)
```

### Arquitetura

O motor (`js/core/game.js`) aplica todas as regras e não conhece o DOM. Ele conversa com a interface por meio de um **agente** assíncrono:

- `onEvent(tipo, dados)` — o motor avisa o que aconteceu (carta comprada, estouro, congelamento…) e espera a animação terminar;
- `chooseMove(jogador)` — pergunta se o jogador vira ou para;
- `chooseTarget(jogador, tipo, candidatos)` — pergunta o alvo de uma carta de ação.

O `GameController` implementa esse agente para o navegador; nos testes, um agente roteirizado controla a partida. O estado é sempre alterado **antes** de cada evento, então a interface só precisa redesenhar a mesa e animar a diferença.

## Créditos

Baseado nas regras do jogo de cartas *Flip 7*, de Eric Olsen (The Op Games). Este é um projeto de estudo, sem fins comerciais.
