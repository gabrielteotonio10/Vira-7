"""Regras do jogo no servidor, com baralho roteirizado (mesmos cenários do motor JS)."""

import json

import pytest

from app.game import GameSession, InvalidAction

from . import helpers as c
from .helpers import humans, types


def start(names, cards, **kwargs):
    """Partida com baralho fixo; o último jogador é o carteador (o primeiro começa)."""
    kwargs.setdefault("first_dealer", len(names) - 1)
    session = GameSession.create(humans(*names), cards=cards, base_seed=1, **kwargs)
    return session, session.drain_events()


def play(session, script):
    """Aplica uma lista de jogadas: ("A", "hit") ou ("A", "target", "B")."""
    seats = {p["name"]: p["seat"] for p in session.data["players"]}
    events = []
    for step in script:
        name, kind = step[0], step[1]
        if kind == "target":
            session.submit(seats[name], "target", seats[step[2]])
        else:
            session.submit(seats[name], "move", kind)
        events += session.drain_events()
    return events


def player(session, name):
    return next(p for p in session.public_state()["players"] if p["name"] == name)


def test_numero_repetido_estoura_e_zera_a_rodada():
    session, _ = start(["A", "B"], [c.num(5), c.num(3), c.num(5)])
    events = play(session, [("A", "hit"), ("B", "stay")])
    assert "bust" in types(events)
    assert player(session, "A")["total"] == 0
    assert player(session, "B")["total"] == 3


def test_segunda_chance_descarta_a_repetida_e_mantem_o_jogador():
    session, _ = start(["A", "B"], [c.second_chance(), c.num(4), c.num(7), c.num(7)])
    events = play(session, [("A", "hit"), ("B", "stay"), ("A", "hit"), ("A", "stay")])
    assert "secondChanceUsed" in types(events) and "bust" not in types(events)
    assert player(session, "A")["total"] == 7
    assert player(session, "B")["total"] == 4


def test_vira7_encerra_a_rodada_e_da_15_de_bonus():
    cards = [c.num(0), c.num(9), *[c.num(v) for v in (1, 2, 3, 4, 5, 6)]]
    session, _ = start(["A", "B"], cards)
    events = play(session, [("A", "hit"), ("B", "stay"), *[("A", "hit")] * 5])
    assert "flip7" in types(events)
    assert player(session, "A")["total"] == 21 + 15
    assert player(session, "A")["flip7Rounds"] == [1]
    assert player(session, "B")["total"] == 9


def test_quem_nao_estourou_tambem_pontua_no_vira7_do_rival():
    cards = [c.num(v) for v in (0, 9, 1, 8, 2, 7, 3, 10, 4, 11, 5, 12, 6)]
    session, _ = start(["A", "B"], cards)
    play(session, [("A", "hit"), ("B", "hit")] * 5 + [("A", "hit")])
    assert player(session, "A")["total"] == 21 + 15
    assert player(session, "B")["total"] == 9 + 8 + 7 + 10 + 11 + 12


def test_congelar_encerra_a_rodada_do_alvo_guardando_os_pontos():
    session, events = start(["A", "B"], [c.num(5), c.freeze(), c.num(8)])
    assert session.awaiting["kind"] == "target" and session.awaiting["action"] == "freeze"
    events += play(session, [("B", "target", "A"), ("B", "hit"), ("B", "stay")])
    assert "freeze" in types(events)
    assert player(session, "A")["total"] == 5
    assert player(session, "B")["total"] == 8


def test_vira_tres_forca_3_cartas_e_guarda_o_congelar():
    cards = [c.flip_three(), c.num(3), c.freeze(), c.num(4), c.num(10)]
    session, events = start(["A", "B", "C"], cards)
    events += play(session, [("A", "target", "B"), ("B", "target", "C"), ("A", "hit"), ("B", "stay"), ("A", "stay")])
    order = types(events)
    assert order.index("flipThreeEnd") < order.index("freeze")
    assert player(session, "B")["total"] == 7
    assert player(session, "C")["total"] == 0
    assert player(session, "A")["total"] == 10


def test_acoes_guardadas_no_vira_tres_sao_descartadas_se_o_alvo_estourar():
    cards = [c.flip_three(), c.num(3), c.freeze(), c.num(3), c.num(5), c.num(6)]
    session, events = start(["A", "B", "C"], cards)
    events += play(session, [("A", "target", "B"), ("A", "hit"), ("C", "stay"), ("A", "stay")])
    discarded = [e for e in events if e["type"] == "cardDiscarded"]
    assert [e["payload"]["reason"] for e in discarded] == ["flipThreeCancelled"]
    assert player(session, "B")["total"] == 0
    assert player(session, "C")["total"] == 5
    assert player(session, "A")["total"] == 6


def test_segunda_segunda_chance_vai_para_outro_jogador_ativo():
    session, events = start(["A", "B"], [c.second_chance(), c.num(2), c.second_chance()])
    events += play(session, [("A", "hit")])
    given = next(e for e in events if e["type"] == "secondChanceGiven")
    assert given["payload"]["to"] == 1
    assert player(session, "B")["secondChance"] is not None


def test_segunda_chance_extra_e_descartada_se_ninguem_puder_receber():
    session, events = start(["A", "B"], [c.second_chance(), c.second_chance(), c.second_chance()])
    events += play(session, [("A", "hit")])
    assert [e["payload"]["reason"] for e in events if e["type"] == "cardDiscarded"] == ["secondChance"]


def test_na_distribuicao_quem_recebeu_cartas_por_vira_tres_nao_recebe_outra():
    cards = [c.flip_three(), c.num(1), c.num(2), c.num(4), c.num(9)]
    session, events = start(["A", "B", "C"], cards)
    events += play(session, [("A", "target", "B")])
    assert [card["value"] for card in player(session, "B")["numbers"]] == [1, 2, 4]
    assert [card["value"] for card in player(session, "C")["numbers"]] == [9]


def test_carteador_gira_e_todas_as_cartas_voltam_ao_monte_a_cada_rodada():
    session = GameSession.create(humans("A", "B", "C"), base_seed=7, first_dealer=2)
    events = session.drain_events()
    while session.public_state()["round"] < 3:
        seat = session.awaiting["seat"]
        if session.awaiting["kind"] == "move":
            session.submit(seat, "move", "stay")
        else:
            session.submit(seat, "target", session.awaiting["candidates"][0])
        events += session.drain_events()

    dealers = [e["payload"]["dealer"] for e in events if e["type"] == "roundStart"]
    assert dealers == [2, 0, 1]
    reshuffles = [e for e in events if e["type"] == "reshuffle" and e["payload"]["newRound"]]
    assert len(reshuffles) == 2
    for event in reshuffles:
        assert event["payload"]["count"] == 94
        assert event["state"]["deck"] == {"size": 94, "totalAvailable": 94}


def test_o_estado_publico_nunca_revela_a_ordem_do_monte():
    session = GameSession.create(humans("A", "B"), base_seed=3)
    blob = json.dumps([session.public_state(), session.drain_events()])
    assert "seed" not in blob and "draw_pile" not in blob and "decisions" not in blob
    assert session.public_state()["deck"]["size"] == 92


def test_jogada_fora_da_vez_e_recusada():
    session, _ = start(["A", "B"], [c.num(5), c.num(3), c.num(9)])
    with pytest.raises(InvalidAction) as error:
        session.submit(1, "move", "hit")
    assert error.value.code == "NOT_YOUR_TURN"


def test_acao_errada_alvo_invalido_e_jogada_desconhecida_sao_recusados():
    session, _ = start(["A", "B", "C"], [c.freeze(), c.num(3), c.num(9)])
    with pytest.raises(InvalidAction) as error:
        session.submit(0, "move", "hit")
    assert error.value.code == "WRONG_ACTION"
    for bad_target in (7, "1", True, None):
        with pytest.raises(InvalidAction) as error:
            session.submit(0, "target", bad_target)
        assert error.value.code == "INVALID_TARGET"

    session.submit(0, "target", 1)
    with pytest.raises(InvalidAction) as error:
        session.submit(session.awaiting["seat"], "move", "dobrar")
    assert error.value.code == "INVALID_MOVE"


def test_token_antigo_impede_jogada_duplicada():
    session, _ = start(["A", "B"], [c.num(5), c.num(3), c.num(9), c.num(1)])
    token = session.awaiting["token"]
    session.submit(0, "move", "hit", token=token)
    session.submit(1, "move", "stay", token=session.awaiting["token"])
    # A volta ao turno: um clique duplo reenviaria o token antigo.
    with pytest.raises(InvalidAction) as error:
        session.submit(0, "move", "hit", token=token)
    assert error.value.code == "STALE_ACTION"


def test_jogada_automatica_para_o_jogador_que_estourou_o_tempo():
    session, _ = start(["A", "B"], [c.num(5), c.num(3), c.num(9)])
    session.auto_play("timeout")
    events = session.drain_events()
    assert types(events)[:2] == ["autoPlay", "stay"]
    assert events[0]["payload"] == {"player": 0, "kind": "move", "reason": "timeout"}
    assert session.awaiting["seat"] == 1


def test_partida_termina_e_nao_aceita_mais_jogadas():
    cards = [c.num(12), c.num(11), c.plus(10), c.num(0)]
    session, _ = start(["A", "B"], cards, target_score=20)
    events = play(session, [("A", "hit"), ("B", "stay"), ("A", "stay")])
    over = events[-1]
    assert over["type"] == "gameOver" and over["payload"]["winner"] == 0
    assert session.status == "finished" and session.awaiting is None
    assert over["state"]["status"] == "finished" and over["state"]["winner"] == 0
    with pytest.raises(InvalidAction) as error:
        session.submit(0, "move", "hit")
    assert error.value.code == "GAME_OVER"

    results = {r["name"]: r for r in session.results()}
    assert results["A"]["isWinner"] and results["A"]["placement"] == 1 and results["A"]["score"] == 22
    assert results["B"]["placement"] == 2 and results["B"]["score"] == 11


def test_empate_acima_da_meta_gera_rodada_extra():
    cards = [c.num(12), c.num(12)]
    session, _ = start(["A", "B"], cards, target_score=10)
    events = play(session, [("A", "stay"), ("B", "stay")])
    assert "tieBreak" in types(events)
    assert session.status == "playing"
    assert session.public_state()["round"] == 2
