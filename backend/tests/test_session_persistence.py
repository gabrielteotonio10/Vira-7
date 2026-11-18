"""Persistência da partida: reconstrução a partir do estado salvo, abandono e CPUs."""

import json
import random

from app.game import GameSession

from . import helpers as c
from .helpers import bots, humans, types


def table_cards(state: dict) -> int:
    count = 0
    for p in state["players"]:
        count += len(p["numbers"]) + len(p["modifiers"]) + len(p["actionCards"]) + len(p["pendingActions"])
        count += 1 if p["secondChance"] else 0
        count += 1 if p["bustCard"] else 0
    return count


def random_answer(session: GameSession, rng: random.Random):
    pending = session.awaiting
    if pending["kind"] == "move":
        return "hit" if rng.random() < 0.6 else "stay"
    return rng.choice(pending["candidates"])


def test_recarregar_a_cada_jogada_da_o_mesmo_resultado_que_jogar_direto():
    """Simula o servidor: a cada requisição a sessão é salva como JSON e reconstruída."""
    for seed in range(1, 26):
        players = humans("A", "B", "C") + bots(1)
        direct = GameSession.create(players, base_seed=seed, target_score=100)
        saved = json.dumps(GameSession.create(players, base_seed=seed, target_score=100).data)
        direct.drain_events()

        rng_a, rng_b = random.Random(seed), random.Random(seed)
        steps = 0
        while not direct.is_over and steps < 2000:
            steps += 1
            reloaded = GameSession.load(json.loads(saved))
            assert reloaded.awaiting == direct.awaiting

            pending = direct.awaiting
            direct.submit(pending["seat"], pending["kind"], random_answer(direct, rng_a), token=pending["token"])
            reloaded.submit(pending["seat"], pending["kind"], random_answer(reloaded, rng_b), token=pending["token"])

            assert reloaded.drain_events() == direct.drain_events()
            assert reloaded.public_state() == direct.public_state()
            saved = json.dumps(reloaded.data)

        assert direct.is_over, f"semente {seed}: a partida não terminou"
        assert GameSession.load(json.loads(saved)).results() == direct.results()


def test_partidas_entre_cpus_terminam_e_conservam_as_94_cartas():
    for seed in range(1, 121):
        session = GameSession.create(humans("Humano") + bots(1 + seed % 6), base_seed=seed)
        events = session.drain_events()
        rng = random.Random(seed)
        while not session.is_over:
            pending = session.awaiting
            session.submit(pending["seat"], pending["kind"], random_answer(session, rng))
            events += session.drain_events()

        assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
        for event in events:
            state = event["state"]
            assert table_cards(state) + state["deck"]["totalAvailable"] == 94, f"semente {seed}: {event['type']}"
            for p in state["players"]:
                values = [card["value"] for card in p["numbers"]]
                assert len(values) == len(set(values))

        final = session.public_state()
        winner = final["winner"]
        totals = [p["total"] for p in final["players"]]
        assert totals[winner] >= 200 and totals.count(max(totals)) == 1 and totals[winner] == max(totals)
        assert final["round"] < 100


def test_quem_sai_da_partida_fica_fora_das_proximas_rodadas():
    cards = [c.num(5), c.num(3), c.num(9)]
    session = GameSession.create(humans("A", "B", "C"), cards=cards, base_seed=4, first_dealer=2)
    session.drain_events()

    session.mark_absent(1)  # B sai fora da vez
    assert types(session.drain_events()) == ["playerLeft"]
    assert session.awaiting["seat"] == 0

    session.submit(0, "move", "stay")
    events = session.drain_events()
    # B foi pulado: parou automaticamente e a vez foi para C.
    stays = [e["payload"]["player"] for e in events if e["type"] == "stay"]
    assert stays == [0, 1]
    assert session.awaiting["seat"] == 2

    session.submit(2, "move", "stay")
    session.drain_events()
    state = session.public_state()
    assert state["round"] == 2
    b = state["players"][1]
    assert b["absent"] and b["status"] == "stayed" and not b["numbers"]


def test_sair_na_propria_vez_passa_o_turno():
    session = GameSession.create(humans("A", "B", "C"), cards=[c.num(5), c.num(3), c.num(9)], base_seed=4, first_dealer=2)
    session.drain_events()
    session.mark_absent(0)
    events = session.drain_events()
    assert types(events)[:2] == ["playerLeft", "stay"]
    assert session.awaiting["seat"] == 1
    reloaded = GameSession.load(json.loads(json.dumps(session.data)))
    assert reloaded.awaiting == session.awaiting


def test_ultimo_jogador_presente_vence_por_abandono():
    session = GameSession.create(humans("A", "B"), base_seed=9)
    session.drain_events()
    session.mark_absent(0)
    events = session.drain_events()
    assert events[-1]["type"] == "gameOver"
    assert events[-1]["payload"]["reason"] == "forfeit" and events[-1]["payload"]["winner"] == 1
    assert session.status == "finished"
    results = {r["name"]: r for r in session.results()}
    assert results["B"]["isWinner"] and results["A"]["forfeited"] and results["A"]["placement"] == 2


def test_partida_e_abandonada_quando_nao_sobra_nenhuma_pessoa():
    session = GameSession.create(humans("A") + bots(2), base_seed=9)
    session.drain_events()
    session.mark_absent(0)
    assert session.status == "abandoned"
    assert session.public_state()["winner"] is None


def test_prazo_do_turno_considera_o_tempo_das_animacoes():
    session = GameSession.create(humans("A", "B"), base_seed=2)
    events = session.drain_events()
    ms = GameSession.presentation_ms(events)
    assert ms >= 1500 + 2 * 950  # anúncio da rodada + duas cartas distribuídas
    assert GameSession.presentation_ms([{"type": "roundEnd"}] * 50) == 45_000
