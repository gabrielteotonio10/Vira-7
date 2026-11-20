"""Regras de duplas: CPUs, abandono, W.O. e distribuição inicial."""

from app.game import GameSession
from app.game import ai, scoring

from .helpers import bots, flip_three, humans, num, second_chance


def team_session(**kwargs):
    return GameSession.create(humans("A", "B") + bots(2), base_seed=3, teams=True, **kwargs)


# ---------------------------------------------------------------------------
# CPUs entendem quem é parceiro
# ---------------------------------------------------------------------------
def test_cpu_nunca_congela_nem_vira_tres_no_proprio_parceiro():
    session = team_session()
    engine = session._engine
    cpu = engine.players[2]  # parceira de A (assento 0)
    partner = engine.players[0]
    rivals = {engine.players[1].seat, engine.players[3].seat}
    candidates = list(engine.players)
    for kind in ("freeze", "flipThree"):
        target = ai.choose_target(cpu, kind, candidates, engine)
        assert target.seat in rivals | {cpu.seat}, f"{kind}: escolheu o parceiro ({partner.seat})"
        assert target is not partner


def test_cpu_doa_a_segunda_chance_extra_ao_parceiro():
    session = team_session()
    engine = session._engine
    cpu, partner = engine.players[2], engine.players[0]
    chosen = ai.choose_target(cpu, "secondChance", [engine.players[0], engine.players[1], engine.players[3]], engine)
    assert chosen is partner


def test_cpu_em_duplas_conta_os_pontos_da_dupla_para_parar():
    session = team_session(target_score=50)
    engine = session._engine
    cpu, partner = engine.players[2], engine.players[0]
    cpu.numbers = [num(3)]
    partner.total = 60  # a dupla já passou da meta e os rivais estão zerados
    assert ai.decide_move(cpu, engine) == "stay"
    engine.teams = False
    assert ai.decide_move(cpu, engine) == "hit", "em partida individual os pontos do parceiro não existem"


# ---------------------------------------------------------------------------
# Abandono
# ---------------------------------------------------------------------------
def test_quem_abandona_nao_ganha_vitoria_mesmo_se_a_dupla_vencer():
    session = GameSession.create(humans("A", "B") + bots(2), base_seed=5, teams=True)
    session.mark_absent(0)
    assert session.status == "playing", "a parceira CPU continua jogando"
    session.data.update(status="finished", winner=2, winnerTeam=0, finishReason="score")
    results = {r["seat"]: r for r in session.results()}
    assert results[0]["forfeited"] and results[0]["isWinner"] is False
    assert results[2]["isWinner"] is True
    assert results[0]["placement"] > results[2]["placement"]


def test_em_duplas_a_partida_acaba_quando_resta_so_uma_dupla():
    session = GameSession.create(humans("A", "B", "C", "D"), base_seed=9, teams=True)
    session.mark_absent(1)
    assert session.status == "playing", "ainda há alguém na dupla B"
    session.mark_absent(3)
    assert session.status == "finished" and session.data["finishReason"] == "forfeit"
    assert session.data["winnerTeam"] == 0
    results = {r["seat"]: r for r in session.results()}
    assert results[0]["isWinner"] and results[2]["isWinner"]
    assert not results[1]["isWinner"] and not results[3]["isWinner"]


# ---------------------------------------------------------------------------
# Distribuição inicial
# ---------------------------------------------------------------------------
def test_segunda_chance_doada_na_distribuicao_nao_tira_a_carta_inicial():
    # A recebe Vira Três, joga em si mesma, vira duas Segundas Chances (a 2ª vai para C) e um 5.
    deck = [flip_three(), second_chance(), second_chance(), num(5), num(3), num(4), num(9), num(8), num(7), num(6)]
    session = GameSession.create(humans("A", "B", "C"), base_seed=1, first_dealer=2, cards=deck)

    def answer_targets():
        while session.awaiting and session.awaiting["kind"] == "target":
            pending = session.awaiting
            wanted = 2 if 2 in pending["candidates"] and pending["action"] == "secondChance" else 0
            session.submit(pending["seat"], "target", wanted, token=pending["token"])

    answer_targets()
    state = session.public_state()
    c = state["players"][2]
    assert c["secondChance"] is not None, "C ficou com a Segunda Chance doada"
    assert c["numbers"], "e ainda recebeu a carta inicial"
    assert state["players"][1]["numbers"], "B também recebeu a dela"
