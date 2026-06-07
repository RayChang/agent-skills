import asyncio
from cove2.schema import SearchResult
from cove2.pipeline import run
from tests.fakes import FakeLLMClient, FakeSearchProvider

PLAN = {
    "draft": "The Eiffel Tower is 250m tall.",
    "needs_verification": True,
    "claims": [{"text": "Eiffel Tower is 250m", "tier": "deep",
                "verification_query": "how tall is the eiffel tower?"}],
}


def _final(corrections):
    return {
        "summary": {"checked": 1, "confirmed": 0, "corrected": len(corrections), "uncertain": 0},
        "corrections": corrections,
        "revised": "The Eiffel Tower is 330m tall [1].",
        "citations": ["http://x"],
    }


def test_gate_false_skips_verification():
    plan = {"draft": "Hello!", "needs_verification": False, "claims": []}
    llm = FakeLLMClient(json_responses=[plan])
    search = FakeSearchProvider(default=[])
    final = asyncio.run(run("hi", llm, search))
    assert final.revised == "Hello!"
    assert search.queries == []
    assert final.summary["checked"] == 0


def test_single_pass_is_default():
    search = FakeSearchProvider(default=[SearchResult("t", "330 m", "http://x")])
    llm = FakeLLMClient(
        json_responses=[PLAN, _final(["250m -> 330m"])],
        text_responses=["Answer: 330 m\nConfidence: High"],
    )
    final = asyncio.run(run("How tall is the Eiffel Tower?", llm, search))
    assert "330m" in final.revised
    assert search.queries.count("how tall is the eiffel tower?") == 1


def test_iteration_reverifies_once():
    search = FakeSearchProvider(default=[SearchResult("t", "330 m", "http://x")])
    llm = FakeLLMClient(
        json_responses=[PLAN, _final(["250m -> 330m"]), _final([])],
        text_responses=["Answer: 330 m\nConfidence: High", "Answer: 330 m\nConfidence: High"],
    )
    final = asyncio.run(run("q", llm, search, max_iterations=2))
    assert search.queries.count("how tall is the eiffel tower?") == 2   # C5: re-verified once
    assert final.corrections == []
