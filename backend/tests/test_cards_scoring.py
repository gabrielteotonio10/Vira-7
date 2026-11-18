"""Baralho e pontuação: as mesmas garantias dos testes do motor JavaScript."""

import random

from app.game import constants as C
from app.game import scoring
from app.game.cards import Deck, create_cards

from .helpers import num, plus, times2


def test_baralho_tem_as_94_cartas_oficiais():
    cards = create_cards()
    assert len(cards) == C.DECK_SIZE
    assert len({card["id"] for card in cards}) == C.DECK_SIZE


def test_cada_numero_n_aparece_n_vezes():
    numbers = [card for card in create_cards() if card["type"] == "number"]
    assert len(numbers) == 79
    for value in range(13):
        expected = 1 if value == 0 else value
        assert sum(1 for card in numbers if card["value"] == value) == expected


def test_modificadores_e_acoes():
    cards = create_cards()
    adds = [c["value"] for c in cards if c["type"] == "modifier" and c["op"] == "add"]
    assert adds == [2, 4, 6, 8, 10]
    assert sum(1 for c in cards if c["type"] == "modifier" and c["op"] == "multiply") == 1
    for action in ("freeze", "flipThree", "secondChance"):
        assert sum(1 for c in cards if c.get("action") == action) == 3


def test_ids_das_cartas_coincidem_com_o_cliente():
    cards = create_cards()
    assert cards[0] == {"id": "c1", "type": "number", "value": 0}
    assert cards[78] == {"id": "c79", "type": "number", "value": 12}
    assert cards[84] == {"id": "c85", "type": "modifier", "op": "multiply", "value": 2}
    assert cards[93]["action"] == "secondChance"


def test_embaralhamento_com_semente_e_reproduzivel():
    order = lambda seed: [c["id"] for c in Deck(random.Random(seed)).draw_pile]
    assert order(42) == order(42)
    assert order(42) != order(43)


def test_baralho_em_ordem_fixa_e_reembaralhamento():
    a, b = num(1), num(2)
    deck = Deck(random.Random(1), cards=[a, b])
    assert deck.draw() is a
    deck.discard(a)
    assert deck.draw() is b
    assert deck.draw() is None
    assert deck.needs_reshuffle()
    assert deck.reshuffle() == 1
    assert deck.size == 1 and deck.used == []


def test_exemplo_oficial_de_pontuacao():
    result = scoring.compute([num(8), num(6), num(3)], [times2(), plus(4)])
    assert result["numbersTotal"] == 34
    assert result["total"] == 38


def test_x2_nao_dobra_bonus_nem_vira7():
    numbers = [num(v) for v in range(7)]
    result = scoring.compute(numbers, [times2(), plus(10)], flip7=True)
    assert result["total"] == 21 * 2 + 10 + 15


def test_quem_estoura_marca_zero():
    result = scoring.compute([num(12)], [plus(10)], status="busted")
    assert result["total"] == 0 and result["busted"]


def test_condicao_de_vitoria_e_empate():
    assert not scoring.check_victory([150, 199], 200)["over"]
    won = scoring.check_victory([210, 245], 200)
    assert won["over"] and won["winner"] == 1
    tie = scoring.check_victory([220, 220, 90], 200)
    assert not tie["over"] and tie["tie"] and tie["leaders"] == [0, 1]


def test_classificacao():
    assert scoring.standings([10, 30, 20]) == [1, 2, 0]
