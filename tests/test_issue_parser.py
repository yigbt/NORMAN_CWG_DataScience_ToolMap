import pytest

from issue_to_entry import MAX_BODY, infer_type, parse_issue, process

TOOL = """id: test-tool
name: Test tool
kind: tool
description: A tool used only in tests.
endpoints: [semi_quantification]
research_questions: [rq-semi-quantification]
maturity: prototype
verification: owner_verified
"""


def body(yaml_text, entry_type="Tool", change="New entry", behalf="_No response_"):
    return (f"### Entry type\n\n{entry_type}\n\n### Change\n\n{change}\n\n### Entry (YAML)\n\n```yaml\n{yaml_text}```\n\n"
            f"### On behalf of\n\n{behalf}\n\n### Consent\n\n- [X] I agree\n")


def run(text, **kw):
    return process(text, issue=5, user="octocat", network=False, write=False, **kw)


def test_valid_new_tool():
    s = run(body(TOOL))
    assert s["ok"], s["errors"]
    assert s["files"] == ["catalogue/tools/test-tool.yaml"]
    assert s["branch"] == "submission/issue-5" and s["title"] == "Add tool: Test tool"


def test_provenance_is_set_by_bot_not_submitter():
    s = run(body(TOOL + "provenance: {source: survey-2025-Q7, added: '1999-01-01'}\n", behalf="Jane Doe, Lab X"))
    assert s["ok"], s["errors"]
    assert s["entry"]["provenance"]["source"] == "submission"
    assert s["entry"]["provenance"]["added"] != "1999-01-01"
    assert s["entry"]["provenance"]["issue"] == 5
    assert s["entry"]["provenance"]["on_behalf_of"] == "Jane Doe, Lab X"
    assert parse_issue(body(TOOL))[3] == ""  # "_No response_" means no on-behalf-of


def test_duplicate_new_entry_rejected():
    s = run(body(TOOL.replace("test-tool", "patroon")))
    assert not s["ok"] and any("already exists" in e for e in s["errors"])


def test_edit_of_missing_entry_rejected():
    s = run(body(TOOL, change="Edit existing entry"))
    assert not s["ok"] and any("No tool" in e for e in s["errors"])


def test_valid_edit_keeps_original_provenance():
    from catalogue_lib import dump_yaml, load_catalogue, strip_private
    e = strip_private(load_catalogue()["tool"]["patroon"])
    e["license"] = "GPL-3.0"
    s = run(body(dump_yaml(e), change="Edit existing entry"))
    assert s["ok"], s["errors"]
    assert s["title"] == "Update tool: patRoon"
    assert s["entry"]["provenance"]["source"] == "survey-2025-Q7" and s["entry"]["provenance"]["issue"] == 5
    assert s["entry"]["license"] == "GPL-3.0"


@pytest.mark.parametrize("yaml_text, fragment", [
    ("id: [unclosed\n", "could not be parsed"),
    ("- a\n- b\n", "one entry"),
    ("!!python/object/apply:os.system ['echo pwned']\n", "could not be parsed"),
])
def test_bad_yaml_rejected(yaml_text, fragment):
    s = run(body(yaml_text))
    assert not s["ok"] and any(fragment in e for e in s["errors"]), s["errors"]


@pytest.mark.parametrize("change, fragment", [
    (("test-tool", "../../etc/passwd"), "does not match"),
    (("rq-semi-quantification", "rq-does-not-exist"), "unknown research question"),
    (("verification: owner_verified", "verification: curator_checked"), "only be set by a curator"),
    (("maturity: prototype", "maturity: world-class"), "is not one of"),
    (("kind: tool\n", "kind: tool\nsecret_field: 1\n"), "Additional properties"),
    (("endpoints: [semi_quantification]", "endpoints: []"), "should be non-empty"),
])
def test_invalid_entries_rejected(change, fragment):
    s = run(body(TOOL.replace(*change)))
    assert not s["ok"] and any(fragment in e for e in s["errors"]), s["errors"]


def test_unknown_doi_without_network_rejected():
    s = run(body(TOOL + "publications: [10.9999/not-a-real-doi]\n"))
    assert not s["ok"] and any("could not be resolved" in e for e in s["errors"])


def test_known_doi_accepted():
    s = run(body(TOOL + "publications: [10.21105/joss.04029]\n"))
    assert s["ok"], s["errors"]


def test_oversized_body_rejected():
    s = run(body(TOOL) + "x" * MAX_BODY)
    assert not s["ok"] and "too large" in s["errors"][0]


def test_type_inferred_from_yaml_when_dropdown_wrong():
    s = run(body(TOOL, entry_type="Dataset"))
    assert s["ok"], s["errors"]
    assert infer_type({"title": "x", "category": "prediction"}) == "research_question"
    assert infer_type({"doi": "10.1/x"}) == "publication"


def test_new_research_question():
    rq = """id: rq-test-question
title: How can something be tested?
category: cross_cutting
description: A research question used in tests.
roadmap: {status: scoping, priority: low}
"""
    s = run(body(rq, entry_type="Research question"))
    assert s["ok"], s["errors"]
