"""Motor de regras do Vira-7 no servidor.

É a autoridade das partidas online: o cliente só envia intenções ("virar", "parar",
"alvo X") e o servidor decide o resultado. As regras são as mesmas do motor JavaScript
usado no modo local (`js/core/`).
"""

from .session import GameSession, InvalidAction

__all__ = ["GameSession", "InvalidAction"]
