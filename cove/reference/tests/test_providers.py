import asyncio
from cove2.providers import TavilySearch


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
