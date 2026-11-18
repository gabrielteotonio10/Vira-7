"""Utilidades compartilhadas pelos testes."""

from __future__ import annotations

import itertools

_ids = itertools.count(1)


def _id() -> str:
    return f"t{next(_ids)}"


def num(value: int) -> dict:
    return {"id": _id(), "type": "number", "value": value}


def plus(value: int) -> dict:
    return {"id": _id(), "type": "modifier", "op": "add", "value": value}


def times2() -> dict:
    return {"id": _id(), "type": "modifier", "op": "multiply", "value": 2}


def freeze() -> dict:
    return {"id": _id(), "type": "action", "action": "freeze"}


def flip_three() -> dict:
    return {"id": _id(), "type": "action", "action": "flipThree"}


def second_chance() -> dict:
    return {"id": _id(), "type": "action", "action": "secondChance"}


def humans(*names: str) -> list[dict]:
    return [{"name": name, "userId": f"user-{name.lower()}"} for name in names]


def bots(count: int) -> list[dict]:
    return [
        {"name": f"CPU {i + 1}", "isBot": True, "riskTolerance": 0.2 + 0.05 * (i % 5)}
        for i in range(count)
    ]


def types(events: list[dict]) -> list[str]:
    return [event["type"] for event in events]
