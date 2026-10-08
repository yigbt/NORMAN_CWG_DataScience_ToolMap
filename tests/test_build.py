import subprocess

from build import compile_catalogue, git_history


def test_compile_has_no_errors_and_expected_parts():
    data, errs = compile_catalogue()
    assert errs == []
    assert set(data) >= {"config", "vocab", "schemas", "entities", "stats"}
    assert data["stats"]["tool"] == len(data["entities"]["tool"]) > 0
    for e in data["entities"]["tool"]:
        assert e["_path"].startswith("catalogue/tools/") and isinstance(e["_history"], list)


def test_survey_demand_matches_survey_notebook():
    # values from notebooks/survey_analysis.ipynb, section 5.3 (Q8 need / Q6 have a tool, n = 34)
    expected = {"rq-transformation-products": (19, 4), "rq-toxicity": (18, 8), "rq-semi-quantification": (15, 3),
                "rq-persistence": (10, 7), "rq-chemical-properties": (10, 5), "rq-analytical-information": (10, 6),
                "rq-bioaccumulation": (4, 4), "rq-antimicrobial": (4, 2)}
    data, _ = compile_catalogue()
    rqs = {r["id"]: r for r in data["entities"]["research_question"]}
    for rid, (need, have) in expected.items():
        sd = rqs[rid]["survey_demand"]
        assert (sd["q8_need"], sd["q6_have_tool"], sd["q8_respondents"]) == (need, have, 34), rid


def test_git_history_parses_coauthors_and_pr(tmp_path, monkeypatch):
    import build
    repo = tmp_path
    run = lambda *a: subprocess.run(["git", "-C", str(repo), *a], check=True, capture_output=True)
    run("init", "-q")
    run("config", "user.email", "curator@example.org")
    run("config", "user.name", "Curator")
    (repo / "x.yaml").write_text("a: 1\n")
    run("add", "x.yaml")
    run("commit", "-q", "-m", "Add tool: X (#12)", "-m", "Co-authored-by: octocat <1+octocat@users.noreply.github.com>")
    monkeypatch.setattr(build, "ROOT", repo)
    hist = git_history("x.yaml")
    assert hist[0]["author"] == "Curator" and hist[0]["coauthors"] == ["octocat"] and hist[0]["pr"] == 12


def test_git_history_outside_repo_is_empty(tmp_path, monkeypatch):
    import build
    monkeypatch.setattr(build, "ROOT", tmp_path)
    assert git_history("nothing.yaml") == []
