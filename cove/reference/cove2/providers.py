"""Provider-agnostic transport protocols and concrete adapters.

The pipeline depends only on the ``LLMClient`` and ``SearchProvider`` protocols,
so any provider can be plugged in. Concrete SDKs are imported lazily so the core
package and its tests have zero third-party dependencies.

NOTE: Verify each SDK's current signature (JSON/tool-use mode) via context7 before
running live -- provider APIs change and must not be relied on from memory.
"""
from __future__ import annotations

from typing import Optional, Protocol, runtime_checkable

from .schema import SearchResult


@runtime_checkable
class LLMClient(Protocol):
    async def complete(self, system: str, user: str) -> str: ...
    async def complete_json(self, system: str, user: str, schema: dict) -> dict: ...


@runtime_checkable
class SearchProvider(Protocol):
    async def search(self, query: str) -> list[SearchResult]: ...


class TavilySearch:
    """SearchProvider backed by Tavily's native async client (returns LLM-ready
    text + sources); no thread hop per search.

    To swap providers, implement ``async search(query) -> list[SearchResult]``:
      - Google CSE: call the Custom Search JSON API, map ``items[].{title,snippet,link}``.
      - RAG store: query your vector DB, map chunks to SearchResult(title, snippet, url).
    """

    def __init__(self, api_key: Optional[str] = None, *, max_results: int = 5, client=None):
        self._max_results = max_results
        if client is not None:
            self._client = client
        else:
            from tavily import AsyncTavilyClient  # lazy import
            self._client = AsyncTavilyClient(api_key=api_key)

    async def search(self, query: str) -> list[SearchResult]:
        raw = await self._client.search(query, max_results=self._max_results)
        return [
            SearchResult(title=r.get("title", ""), snippet=r.get("content", ""), url=r.get("url", ""))
            for r in raw.get("results", [])
        ]


class AnthropicLLM:
    """LLMClient backed by the Anthropic Messages API.

    JSON output is obtained via a forced tool call. Verify the tool-use signature
    against current docs via context7 before live use.
    """

    def __init__(self, *, model: str = "claude-sonnet-5", api_key: Optional[str] = None,
                 max_tokens: int = 4096, client=None):  # verify current model IDs via context7 before live use
        self.model = model
        self.max_tokens = max_tokens
        if client is not None:
            self._client = client
        else:
            from anthropic import AsyncAnthropic  # lazy import
            self._client = AsyncAnthropic(api_key=api_key)

    @staticmethod
    def _check_truncation(msg) -> None:
        # A response cut off at max_tokens silently drops the tail of the draft or
        # the revised answer (and can leave forced-tool JSON unparseable), so it
        # must fail loudly rather than flow downstream as a complete result.
        if getattr(msg, "stop_reason", None) == "max_tokens":
            raise ValueError(
                "response truncated at max_tokens; construct AnthropicLLM with a "
                "larger max_tokens for long drafts/revisions"
            )

    async def complete(self, system: str, user: str) -> str:
        msg = await self._client.messages.create(
            model=self.model, max_tokens=self.max_tokens, system=system,
            messages=[{"role": "user", "content": user}],
        )
        self._check_truncation(msg)
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")

    async def complete_json(self, system: str, user: str, schema: dict) -> dict:
        tool = {"name": "emit", "description": "Emit the structured result.", "input_schema": schema}
        msg = await self._client.messages.create(
            model=self.model, max_tokens=self.max_tokens, system=system,
            messages=[{"role": "user", "content": user}],
            tools=[tool], tool_choice={"type": "tool", "name": "emit"},
        )
        self._check_truncation(msg)
        for b in msg.content:
            if getattr(b, "type", "") == "tool_use":
                return b.input
        raise ValueError("model did not emit structured output")
