"""Append-only local event log, durable across API restarts."""

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class BlackBox:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(path) as db:
            db.execute(
                """CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                occurred_at TEXT NOT NULL,
                kind TEXT NOT NULL,
                payload_json TEXT NOT NULL
                )"""
            )

    def append(self, kind: str, payload: dict[str, Any]) -> None:
        with sqlite3.connect(self.path) as db:
            db.execute(
                "INSERT INTO events (occurred_at, kind, payload_json) VALUES (?, ?, ?)",
                (datetime.now(timezone.utc).isoformat(), kind, json.dumps(payload)),
            )

    def recent(self, limit: int = 20) -> list[dict[str, Any]]:
        with sqlite3.connect(self.path) as db:
            rows = db.execute(
                "SELECT id, occurred_at, kind, payload_json FROM events ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            {"id": row[0], "occurred_at": row[1], "kind": row[2], "payload": json.loads(row[3])}
            for row in rows
        ]
