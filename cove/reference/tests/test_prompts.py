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


def test_prompts_frame_inputs_as_untrusted_data():
    # Boundary protection: each stage that ingests untrusted text must frame it as
    # data, not instructions, so injected directives are not obeyed.
    assert "untrusted" in _text("phase1.md")                 # query sanitization
    assert "untrusted" in _text("phase2_deep.md")            # question + evidence
    assert "untrusted" in _text("phase3.md")                 # draft + results


def test_phase1_strips_injected_instructions_from_queries():
    t = _text("phase1.md")
    assert "instruction-free" in t and "verification_query" in t


def test_phase1_anchors_freshness_sensitive_queries_to_a_date():
    t = _text("phase1.md")
    assert "date-anchored" in t and "freshness" in t


def test_phase2_deep_calibrates_confidence_by_corroboration():
    t = _text("phase2_deep.md")
    assert "independent" in t and "supported-by:" in t


def test_phase3_gates_corrections_on_confidence():
    t = _text("phase3.md")
    assert "high or" in t and "low-confidence" in t
