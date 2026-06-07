"""Deterministic test doubles for hermetic pipeline tests."""
from __future__ import annotations

from cove2.schema import SearchResult


class FakeLLMClient:
    def __init__(self, *, json_responses=None, text_responses=None):
        self.json_responses = list(json_responses or [])
        self.text_responses = list(text_responses or [])
        self.complete_calls = []   # list[(system, user)]
        self.json_calls = []       # list[(system, user, schema)]

    async def complete(self, system: str, user: str) -> str:
        self.complete_calls.append((system, user))
        return self.text_responses.pop(0)

    async def complete_json(self, system: str, user: str, schema: dict) -> dict:
        self.json_calls.append((system, user, schema))
        return self.json_responses.pop(0)


class FakeSearchProvider:
    def __init__(self, *, results_by_query=None, default=None):
        self.results_by_query = results_by_query or {}
        self.default = default or []
        self.queries = []          # records every query searched

    async def search(self, query: str) -> list[SearchResult]:
        self.queries.append(query)
        return self.results_by_query.get(query, self.default)
