"""Árbitro: tarefa em segundo plano que mantém as partidas andando.

A cada poucos segundos, procura partidas cujo prazo de turno venceu ou cujo jogador
da vez perdeu a conexão, e joga por ele (para, ou escolhe o alvo automaticamente).
Como toda gravação exige a versão atual da partida, vários processos da API podem
rodar o árbitro ao mesmo tempo sem aplicar a mesma jogada duas vezes.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from . import games

log = logging.getLogger("vira7.referee")


async def sweep(store, grace_seconds: int) -> int:
    """Uma passada pelo árbitro. Retorna quantas jogadas automáticas foram aplicadas."""
    applied = 0
    now = games.utcnow()
    for game in await store.list_playing_games():
        deadline = games.parse_time(game["turn_deadline"])
        overdue = deadline is not None and now >= deadline
        if not overdue and game["awaiting_user_id"]:
            seen = await store.get_presence(game["room_id"], game["awaiting_user_id"])
            overdue = seen is None or now - seen > timedelta(seconds=grace_seconds)
        if not overdue:
            continue
        try:
            result = await games.tick(store, game["id"], grace_seconds)
            applied += 1 if result["applied"] else 0
        except Exception:  # uma partida com problema não pode parar as outras
            log.exception("Falha ao arbitrar a partida %s", game["id"])
    return applied


async def run(store, interval: float, grace_seconds: int) -> None:
    while True:
        try:
            await sweep(store, grace_seconds)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Falha na passada do árbitro")
        await asyncio.sleep(interval)
