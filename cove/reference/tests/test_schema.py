import pytest
from cove2.schema import parse_plan, Plan


def test_parse_plan_valid():
    raw = {
        "draft": "d",
        "needs_verification": True,
        "claims": [
            {"text": "x", "tier": "deep", "verification_query": "what is x?"},
            {"text": "y", "tier": "shallow"},
        ],
    }
    plan = parse_plan(raw)
    assert isinstance(plan, Plan)
    assert plan.needs_verification is True
    assert plan.claims[0].verification_query == "what is x?"
    assert plan.claims[1].tier == "shallow"


def test_parse_plan_deep_requires_query():
    raw = {"draft": "d", "needs_verification": True,
           "claims": [{"text": "x", "tier": "deep"}]}
    with pytest.raises(ValueError):
        parse_plan(raw)


def test_parse_plan_rejects_non_bool_gate():
    with pytest.raises(ValueError):
        parse_plan({"draft": "d", "needs_verification": "yes", "claims": []})
