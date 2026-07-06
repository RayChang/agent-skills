import asyncio
from cove2.pipeline import phase1_plan
from tests.fakes import FakeLLMClient


def test_phase1_parses_plan():
    raw = {"draft": "hi there", "needs_verification": False, "claims": []}
    llm = FakeLLMClient(json_responses=[raw])
    plan = asyncio.run(phase1_plan(llm, "hi"))
    assert plan.needs_verification is False
    assert plan.draft == "hi there"


def test_phase1_retries_once_on_invalid_json():
    bad = {"draft": "d", "needs_verification": "nope", "claims": []}
    good = {"draft": "d", "needs_verification": True, "claims": []}
    llm = FakeLLMClient(json_responses=[bad, good])
    plan = asyncio.run(phase1_plan(llm, "q"))
    assert plan.needs_verification is True
    assert len(llm.json_calls) == 2


def test_phase1_retry_feeds_back_validation_error():
    bad = {"draft": "d", "needs_verification": "nope", "claims": []}
    good = {"draft": "d", "needs_verification": True, "claims": []}
    llm = FakeLLMClient(json_responses=[bad, good])
    asyncio.run(phase1_plan(llm, "q"))
    _system, retry_user, _schema = llm.json_calls[1]
    assert "invalid" in retry_user and "needs_verification" in retry_user


def test_phase1_today_anchors_the_query():
    raw = {"draft": "hi", "needs_verification": False, "claims": []}
    llm = FakeLLMClient(json_responses=[raw])
    asyncio.run(phase1_plan(llm, "latest version of X?", today="2026-07-06"))
    _system, user, _schema = llm.json_calls[0]
    assert "Today's date: 2026-07-06" in user
    assert "latest version of X?" in user
