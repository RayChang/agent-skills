import asyncio
from cove2.schema import Plan, Claim, SearchResult
from cove2.pipeline import phase2_verify
from tests.fakes import FakeLLMClient, FakeSearchProvider


def test_deep_verifier_never_sees_draft():
    plan = Plan(
        draft="SECRET-DRAFT-TEXT",
        needs_verification=True,
        claims=[Claim("Paris is the capital", "deep", "what is the capital of France?")],
    )
    search = FakeSearchProvider(default=[SearchResult("t", "Paris is the capital", "http://x")])
    llm = FakeLLMClient(text_responses=["Answer: Paris\nConfidence: High"])

    results = asyncio.run(phase2_verify(plan, search, llm))

    assert results[0].externally_grounded is True
    assert results[0].sources == ["http://x"]
    assert results[0].answer == "Paris"
    assert results[0].confidence == "High"
    # C3: the verifier must not receive the draft in system or user
    system, user = llm.complete_calls[0]
    assert "SECRET-DRAFT-TEXT" not in system
    assert "SECRET-DRAFT-TEXT" not in user
    # the search used the open verification_query
    assert search.queries == ["what is the capital of France?"]


def test_shallow_claim_is_not_searched():
    plan = Plan(
        draft="d",
        needs_verification=True,
        claims=[Claim("therefore it follows", "shallow")],
    )
    search = FakeSearchProvider(default=[SearchResult("t", "s", "u")])
    llm = FakeLLMClient(text_responses=["Answer: looks internally consistent\nConfidence: Low"])

    results = asyncio.run(phase2_verify(plan, search, llm))

    assert search.queries == []                 # C4: no external search for shallow
    assert results[0].externally_grounded is False
    assert results[0].sources == []


def test_gate_false_returns_empty():
    plan = Plan(draft="hi", needs_verification=False, claims=[])
    search = FakeSearchProvider(default=[])
    llm = FakeLLMClient()
    assert asyncio.run(phase2_verify(plan, search, llm)) == []
