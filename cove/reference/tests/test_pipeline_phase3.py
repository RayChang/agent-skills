import asyncio
from cove2.schema import Claim, ClaimResult, SearchResult
from cove2.pipeline import phase3_finalize
from tests.fakes import FakeLLMClient


def test_phase3_emits_citations_and_sees_draft():
    results = [
        ClaimResult(
            claim=Claim("Eiffel is 250m", "deep", "how tall is the eiffel tower?"),
            answer="330 m", confidence="High", externally_grounded=True,
            sources=["http://x"], evidence=[SearchResult("t", "330 m", "http://x")],
        )
    ]
    out = {
        "summary": {"checked": 1, "confirmed": 0, "corrected": 1, "uncertain": 0},
        "corrections": ["250m -> 330m (basis: [1])"],
        "revised": "The Eiffel Tower is 330m tall [1].",
        "citations": ["http://x"],
    }
    llm = FakeLLMClient(json_responses=[out])

    final = asyncio.run(phase3_finalize(llm, "The Eiffel Tower is 250m tall.", results))

    assert final.citations == ["http://x"]
    assert "[1]" in final.revised
    assert final.summary["corrected"] == 1
    # the reviewer DOES receive the draft (its job is to compare draft vs evidence)
    _system, user, _schema = llm.json_calls[0]
    assert "The Eiffel Tower is 250m tall." in user
