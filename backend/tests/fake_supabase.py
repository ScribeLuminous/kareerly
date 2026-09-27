"""In-memory stand-in for learning.supabase_client.SupabaseRest (eq/neq/lt/in/is and or filters only)."""
from __future__ import annotations

import copy
import itertools
import uuid


def _condition(row, column, expression):
    op, _, value = expression.partition(".")
    current = row.get(column)
    if op == "eq":
        return str(current) == value
    if op == "neq":
        return current is not None and str(current) != value
    if op == "lt":
        return current is not None and str(current) < value
    if op == "in":
        return str(current) in [item.strip('"') for item in value.strip("()").split(",")]
    if op == "is" and value == "null":
        return current is None
    return True


def _matches(row, filters):
    for column, expression in filters.items():
        if column in {"select", "order", "limit", "offset", "on_conflict"}:
            continue
        if column == "or":
            # "(a.is.null,a.neq.x)": any one condition.
            parts = [part.split(".", 1) for part in expression.strip("()").split(",")]
            if not any(_condition(row, name, rest) for name, rest in parts):
                return False
        elif not _condition(row, column, expression):
            return False
    return True


class FakeSupabase:
    def __init__(self, tables=None):
        self.tables = {name: [dict(row) for row in rows] for name, rows in (tables or {}).items()}
        self.ids = itertools.count(5001)
        self.calls = []

    def rows(self, table):
        return self.tables.setdefault(table, [])

    def select(self, table, params):
        self.calls.append(("select", table, dict(params)))
        found = [copy.deepcopy(row) for row in self.rows(table) if _matches(row, params)]
        limit = int(params.get("limit", 10**9))
        offset = int(params.get("offset", 0))
        return found[offset:offset + limit]

    def select_all(self, table, params, page_size=1000, limit=50_000):
        return self.select(table, {**params, "limit": str(limit)})

    def insert(self, table, body, *, upsert_on=None, returning=True):
        self.calls.append(("insert", table, copy.deepcopy(body)))
        stored = []
        for item in body if isinstance(body, list) else [body]:
            item = dict(item)
            existing = None
            if upsert_on:
                keys = upsert_on.split(",")
                existing = next((row for row in self.rows(table) if all(row.get(k) == item.get(k) for k in keys)), None)
            if existing is not None:
                existing.update(item)
                stored.append(copy.deepcopy(existing))
                continue
            if table == "ranking_models" and item.get("status") == "active" and any(
                    row.get("status") == "active" for row in self.rows(table)):
                raise AssertionError("two active ranking models")
            item.setdefault("id", str(uuid.uuid4()))
            item.setdefault("status", "pending" if table == "skill_candidates" else item.get("status"))
            self.rows(table).append(item)
            stored.append(copy.deepcopy(item))
        return stored if returning else []

    def update(self, table, filters, body):
        self.calls.append(("update", table, dict(filters), dict(body)))
        changed = []
        for row in self.rows(table):
            if _matches(row, filters):
                row.update(body)
                changed.append(copy.deepcopy(row))
        return changed

    def rpc(self, function, body=None):
        assert function == "next_skill_addition_id"
        return f"SK{next(self.ids)}"
