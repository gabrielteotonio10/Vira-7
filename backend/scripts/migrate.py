"""Aplica as migrations de `database/migrations/` no PostgreSQL do Supabase.

    python scripts/migrate.py            # aplica as que faltam
    python scripts/migrate.py --status   # mostra o que já foi aplicado
    python scripts/migrate.py --print    # imprime todo o SQL (para colar no SQL Editor)

Usa DATABASE_URL (veja backend/.env.example). Cada arquivo roda em uma transação e é
registrado em `public.schema_migrations`, então rodar de novo não repete nada.
Sem acesso direto ao banco, use `--print` e cole o resultado no SQL Editor do Supabase.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = BACKEND_DIR.parent / "database" / "migrations"

TRACKING_TABLE = """
create table if not exists public.schema_migrations (
  filename    text primary key,
  checksum    text not null,
  applied_at  timestamptz not null default now()
);
alter table public.schema_migrations enable row level security;
revoke all on public.schema_migrations from anon, authenticated;
"""


def migration_files() -> list[Path]:
    return sorted(MIGRATIONS_DIR.glob("*.sql"))


def checksum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def print_all() -> None:
    for path in migration_files():
        print(f"-- >>> {path.name}")
        print(path.read_text(encoding="utf-8").rstrip())
        print()


def main() -> int:
    parser = argparse.ArgumentParser(description="Aplica as migrations do Vira-7.")
    parser.add_argument("--status", action="store_true", help="só lista as migrations e o estado")
    parser.add_argument("--print", dest="print_sql", action="store_true", help="imprime todo o SQL")
    args = parser.parse_args()

    if args.print_sql:
        print_all()
        return 0

    load_dotenv(BACKEND_DIR / ".env")
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        print("DATABASE_URL não está definido em backend/.env.", file=sys.stderr)
        print("Alternativa: python scripts/migrate.py --print  e cole no SQL Editor do Supabase.", file=sys.stderr)
        return 2

    import psycopg

    with psycopg.connect(url, autocommit=True) as connection:
        connection.execute(TRACKING_TABLE)
        applied = {
            row[0]: row[1]
            for row in connection.execute("select filename, checksum from public.schema_migrations")
        }

        pending = 0
        for path in migration_files():
            state = "aplicada" if path.name in applied else "pendente"
            if path.name in applied and applied[path.name] != checksum(path):
                state = "aplicada (o arquivo mudou desde então)"
            if args.status:
                print(f"{path.name:<32} {state}")
                continue
            if path.name in applied:
                continue

            print(f"Aplicando {path.name}… ", end="", flush=True)
            try:
                with connection.transaction():
                    connection.execute(path.read_text(encoding="utf-8"))
                    connection.execute(
                        "insert into public.schema_migrations (filename, checksum) values (%s, %s)",
                        (path.name, checksum(path)),
                    )
            except psycopg.Error as error:
                print("ERRO")
                print(f"  {error}", file=sys.stderr)
                return 1
            print("ok")
            pending += 1

        if not args.status:
            # Faz a API REST do Supabase enxergar as tabelas e funções novas.
            connection.execute("notify pgrst, 'reload schema'")
            print(f"{pending} migration(s) aplicada(s)." if pending else "Banco já está atualizado.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
