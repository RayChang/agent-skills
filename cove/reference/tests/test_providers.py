import asyncio

import pytest

from cove2.providers import TavilySearch, AnthropicLLM, LLMClient, SearchProvider
from tests.fakes import FakeLLMClient, FakeSearchProvider


class _FakeTavilyClient:
    """Mimics tavily.TavilyClient.search() without network."""
    def search(self, query, max_results):
        return {"results": [{"title": "T", "content": "C", "url": "http://u"}]}


def test_tavily_maps_results_to_searchresult():
    s = TavilySearch(client=_FakeTavilyClient())
    out = asyncio.run(s.search("q"))
    assert len(out) == 1
    assert out[0].url == "http://u"
    assert out[0].snippet == "C"
    assert out[0].title == "T"


# ---- fake Anthropic client (no SDK, no network) ----

class _Block:
    def __init__(self, type_, **kw):
        self.type = type_
        for k, v in kw.items():
            setattr(self, k, v)


def _anthropic_client_returning(blocks):
    class _Messages:
        @staticmethod
        async def create(**kwargs):
            class _Msg:
                content = blocks
            return _Msg()

    class _Client:
        messages = _Messages()

    return _Client()


def test_anthropic_complete_concatenates_text_blocks():
    client = _anthropic_client_returning([_Block("text", text="hel"), _Block("text", text="lo")])
    llm = AnthropicLLM(client=client)
    assert asyncio.run(llm.complete("sys", "usr")) == "hello"


def test_anthropic_complete_json_returns_tool_input():
    client = _anthropic_client_returning([_Block("tool_use", input={"k": "v"})])
    llm = AnthropicLLM(client=client)
    assert asyncio.run(llm.complete_json("sys", "usr", {})) == {"k": "v"}


def test_anthropic_complete_json_raises_without_tool_use():
    client = _anthropic_client_returning([_Block("text", text="oops")])
    llm = AnthropicLLM(client=client)
    with pytest.raises(ValueError):
        asyncio.run(llm.complete_json("sys", "usr", {}))


def test_fakes_satisfy_protocols():
    assert isinstance(FakeLLMClient(), LLMClient)
    assert isinstance(FakeSearchProvider(), SearchProvider)
