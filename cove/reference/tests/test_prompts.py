from pathlib import Path

PROMPTS = Path(__file__).resolve().parent.parent / "cove2" / "prompts"


def _text(name):
    return (PROMPTS / name).read_text(encoding="utf-8").lower()


def test_phase1_requires_open_questions_not_yesno():
    t = _text("phase1.md")
    assert "open" in t and "yes/no" in t            # C2


def test_deep_verifier_is_isolated_from_draft():
    t = _text("phase2_deep.md")
    assert "do not have access" in t                # C3


def test_shallow_verifier_is_conservative():
    t = _text("phase2_shallow.md")
    assert "caveat" in t and "do not" in t          # C4


def test_phase3_requires_citations_and_honesty():
    t = _text("phase3.md")
    assert "citation" in t and "unable to verify" in t
