"""Acesso a dados.

Há duas implementações com a mesma interface:

  * `SupabaseStore` — produção: PostgreSQL do Supabase, via REST/RPC com a service role;
  * `MemoryStore`   — testes automatizados e modo de desenvolvimento local.

As regras atômicas (lotação, assentos, versão da partida) vivem nas funções SQL de
`database/migrations/`; o `MemoryStore` reproduz o mesmo comportamento em memória.
"""

from .memory import MemoryStore
from .supabase_store import SupabaseStore

__all__ = ["MemoryStore", "SupabaseStore"]
