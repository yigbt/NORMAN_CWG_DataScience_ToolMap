"""Validate the catalogue and compile it, with git history, into site/data/catalogue.json.

Usage: python scripts/build.py [--check]   (--check: validate only, write nothing)
Exit code 1 on any validation error.
"""
import json
import re
import subprocess
import sys

from catalogue_lib import ROOT, TYPES, load_catalogue, load_schemas, load_vocab, load_yaml, strip_private, \
    validate_catalogue

OUT = ROOT / "site" / "data" / "catalogue.json"
COAUTHOR = re.compile(r"^Co-authored-by:\s*(.+?)\s*<", re.MULTILINE)
PR_REF = re.compile(r"(?:Merge pull request #|\(#)(\d+)")


def git_history(rel_path):
    """List of {date, author, coauthors, message, sha, pr} for one file, newest first ([] outside git)."""
    try:
        out = subprocess.run(
            ["git", "-C", str(ROOT), "log", "--follow", "--format=%H%x1f%an%x1f%aI%x1f%s%x1f%b%x1e", "--", rel_path],
            capture_output=True, text=True, check=True).stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []
    hist = []
    for rec in filter(str.strip, out.split("\x1e")):
        sha, author, when, subject, body = (rec.strip("\n").split("\x1f") + [""] * 5)[:5]
        pr = PR_REF.search(subject) or PR_REF.search(body)
        hist.append({"sha": sha, "author": author, "date": when[:10], "message": subject,
                     "coauthors": COAUTHOR.findall(body), "pr": int(pr.group(1)) if pr else None})
    return hist


def compile_catalogue():
    cat = load_catalogue()
    errs = validate_catalogue(cat)
    if errs:
        return None, errs
    data = {"config": load_yaml((ROOT / "config.yaml").read_text(encoding="utf-8")),
            "vocab": load_vocab(), "schemas": load_schemas(), "entities": {}}
    for etype, entries in cat.items():
        data["entities"][etype] = []
        for e in entries.values():
            rel = e["_path"]  # relative to tool_map/ (the repository root)
            data["entities"][etype].append({**strip_private(e), "_path": rel, "_history": git_history(rel)})
    tool_rqs = {}
    for t in data["entities"]["tool"]:
        for rq in t.get("research_questions", []):
            tool_rqs[rq] = tool_rqs.get(rq, 0) + 1
    data["stats"] = {etype: len(v) for etype, v in data["entities"].items()} | {"tools_per_rq": tool_rqs}
    return data, []


def main():
    data, errs = compile_catalogue()
    if errs:
        print("Validation failed:\n  " + "\n  ".join(errs), file=sys.stderr)
        sys.exit(1)
    print("OK: " + ", ".join(f"{data['stats'][t]} {t}" for t in TYPES))
    if "--check" not in sys.argv:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
