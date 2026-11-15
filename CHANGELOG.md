# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.
O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/).

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
