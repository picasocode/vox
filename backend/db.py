"""
Persistence layer for sessions, conversation history, state, pending actions
and audit events.

Two backends, selected by environment:

- PostgreSQL (Neon / Vercel Postgres) when DATABASE_URL (or POSTGRES_URL) is
  set — used on production deployments so data survives cold starts.
- SQLite at ``settings.database_path`` otherwise — local default, zero setup.
"""
import os
import sqlite3

from backend.config import settings

_DATABASE_URL = (os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL") or "").strip()
USE_POSTGRES = bool(_DATABASE_URL)

if USE_POSTGRES:
    import psycopg
    from psycopg.rows import dict_row


def db_backend() -> str:
    return "postgres" if USE_POSTGRES else "sqlite"


def q(sql: str) -> str:
    """Translate SQLite-style ``?`` placeholders for the active backend."""
    return sql.replace("?", "%s") if USE_POSTGRES else sql


def get_db_connection():
    if USE_POSTGRES:
        # prepare_threshold=None: prepared statements are incompatible with
        # pgbouncer/Neon pooling in transaction mode.
        return psycopg.connect(_DATABASE_URL, prepare_threshold=None, row_factory=dict_row)
    conn = sqlite3.connect(str(settings.database_path), timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


_DDL_SQLITE = """
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    account_id TEXT,
    role TEXT NOT NULL DEFAULT 'public',
    display_name TEXT NOT NULL DEFAULT 'Guest',
    kit_token TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS conversation_turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    account_id TEXT,
    user_text TEXT NOT NULL,
    assistant_text TEXT NOT NULL,
    intent TEXT,
    module TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS conversation_state (
    session_id TEXT PRIMARY KEY,
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS pending_actions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    intent TEXT NOT NULL,
    slots_json TEXT NOT NULL,
    summary TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    result_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    account_id TEXT,
    event_type TEXT NOT NULL,
    tool_name TEXT,
    outcome TEXT NOT NULL,
    metadata_json TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_turns_session ON conversation_turns(session_id);
CREATE INDEX IF NOT EXISTS idx_turns_account ON conversation_turns(account_id);
CREATE INDEX IF NOT EXISTS idx_pending_session ON pending_actions(session_id);
CREATE INDEX IF NOT EXISTS idx_pending_account ON pending_actions(account_id);
"""

_DDL_POSTGRES = [
    """CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        account_id TEXT,
        role TEXT NOT NULL DEFAULT 'public',
        display_name TEXT NOT NULL DEFAULT 'Guest',
        kit_token TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        revoked_at TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS conversation_turns (
        id BIGSERIAL PRIMARY KEY,
        session_id TEXT NOT NULL,
        account_id TEXT,
        user_text TEXT NOT NULL,
        assistant_text TEXT NOT NULL,
        intent TEXT,
        module TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
    )""",
    """CREATE TABLE IF NOT EXISTS conversation_state (
        session_id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
    )""",
    """CREATE TABLE IF NOT EXISTS pending_actions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        intent TEXT NOT NULL,
        slots_json TEXT NOT NULL,
        summary TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
    )""",
    """CREATE TABLE IF NOT EXISTS audit_events (
        id BIGSERIAL PRIMARY KEY,
        session_id TEXT,
        account_id TEXT,
        event_type TEXT NOT NULL,
        tool_name TEXT,
        outcome TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_turns_session ON conversation_turns(session_id)",
    "CREATE INDEX IF NOT EXISTS idx_turns_account ON conversation_turns(account_id)",
    "CREATE INDEX IF NOT EXISTS idx_pending_session ON pending_actions(session_id)",
    "CREATE INDEX IF NOT EXISTS idx_pending_account ON pending_actions(account_id)",
]


def init_db() -> None:
    if USE_POSTGRES:
        conn = get_db_connection()
        try:
            for statement in _DDL_POSTGRES:
                conn.execute(statement)
            conn.commit()
        finally:
            conn.close()
        return
    conn = sqlite3.connect(str(settings.database_path), timeout=30.0)
    conn.executescript(_DDL_SQLITE)
    conn.close()


# Auto-initialize on module import. Best effort on Postgres: if the database
# is momentarily unreachable (Neon compute waking from suspension), skip it —
# the schema is created persistently on the first successful run.
try:
    init_db()
except Exception:
    if not USE_POSTGRES:
        raise
