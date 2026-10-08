"""Turn a submission issue into a validated catalogue file (run by .github/workflows/submission.yml).

Usage:
  python scripts/issue_to_entry.py --event "$GITHUB_EVENT_PATH" --summary summary.json [--no-network]
  python scripts/issue_to_entry.py --body-file body.md --issue 12 --user octocat --summary s.json [--no-network]

The issue body is untrusted input: it is size-limited, parsed with a safe YAML loader, validated against the
JSON schema, and written only to catalogue/<type>/<validated id>.yaml. Provenance is set here, not by the
submitter. Missing publications referenced by DOI are created from Crossref (unless --no-network).
The summary JSON tells the workflow whether to open a PR or to comment the errors on the issue.
"""
import argparse
import copy
import json
import re
from datetime import date

from catalogue_lib import CATALOGUE, TYPES, crossref_publication, dump_yaml, entry_filename, load_catalogue, \
    load_yaml, normalize, reference_errors, schema_errors, validators

MAX_BODY = 30_000
SECTION = re.compile(r"^###\s+(.+?)\s*$", re.MULTILINE)
FENCE = re.compile(r"```(?:ya?ml)?\s*\n(.*?)```", re.DOTALL)
TYPE_LABELS = {"tool": "tool", "research question": "research_question", "research_question": "research_question",
               "dataset": "dataset", "publication": "publication"}


def sections(body):
    """Issue-form body -> {heading (lower case): text}."""
    parts = SECTION.split(body)
    return {parts[i].strip().lower(): parts[i + 1].strip() for i in range(1, len(parts) - 1, 2)}


def infer_type(entry):
    """Entry type from the fields present (the issue-form dropdown may not be prefilled reliably)."""
    if "kind" in entry and "endpoints" in entry:
        return "tool"
    if "category" in entry and "title" in entry:
        return "research_question"
    if "data_type" in entry:
        return "dataset"
    if "doi" in entry and "id" not in entry:
        return "publication"
    return None


def parse_issue(body):
    """-> (entry_type, change, entry_dict, on_behalf_of, errors)."""
    if len(body) > MAX_BODY:
        return None, None, None, None, [f"Submission is too large ({len(body)} > {MAX_BODY} characters)."]
    s = sections(body)
    errs = []
    etype = TYPE_LABELS.get(s.get("entry type", "").strip().lower())
    change = s.get("change", "").strip().lower()
    change = "edit" if change.startswith("edit") else "new" if change.startswith("new") else None
    if not change:
        errs.append("Field 'Change' must be 'New entry' or 'Edit existing entry'.")
    raw = s.get("entry (yaml)", "")
    m = FENCE.search(raw)
    text = m.group(1) if m else raw
    entry = None
    try:
        entry = load_yaml(text)
    except Exception as e:  # yaml.YAMLError and friends; message is shown to the submitter
        errs.append(f"The YAML could not be parsed: {e}")
    if entry is not None and not isinstance(entry, dict):
        errs.append("The YAML must describe one entry (a mapping of field: value).")
        entry = None
    elif entry is None and not errs:
        errs.append("Field 'Entry (YAML)' is empty.")
    if entry:
        etype = infer_type(entry) or etype
    if not etype and not errs:
        errs.append("Could not tell which kind of entry this is; please set 'Entry type'.")
    behalf = s.get("on behalf of", "").strip()
    behalf = "" if behalf.lower() in {"", "_no response_", "none", "-"} else behalf[:200]
    return etype, change, entry, behalf, errs


def process(body, issue, user, network=True, write=True):
    """Validate a submission and (optionally) write it. Returns the summary dict."""
    summary = {"ok": False, "issue": issue, "user": user, "files": [], "errors": []}
    etype, change, entry, behalf, errs = parse_issue(body)
    if errs:
        summary["errors"] = errs
        return summary

    cat = load_catalogue()
    folder, _, key_field = TYPES[etype]
    key = entry.get(key_field)
    if etype == "publication" and isinstance(key, str):
        key = entry[key_field] = key.strip().lower()
    existing = cat[etype].get(key) if isinstance(key, str) else None

    if change == "new" and existing:
        errs.append(f"A {etype.replace('_', ' ')} with {key_field} '{key}' already exists; choose 'Edit existing entry'.")
    if change == "edit" and not existing:
        errs.append(f"No {etype.replace('_', ' ')} with {key_field} '{key}' exists to edit.")

    today = date.today().isoformat()
    if existing:  # provenance of the original entry is kept; this issue is recorded as the latest change
        entry["provenance"] = {**existing["provenance"], "issue": issue}
    else:
        entry["provenance"] = {"source": "submission", "added": today, "issue": issue}
    if behalf:
        entry["provenance"]["on_behalf_of"] = behalf
    if etype == "research_question" and isinstance(entry.get("roadmap"), dict):
        entry["roadmap"]["updated"] = today

    if entry.get("verification") == "curator_checked" and (existing or {}).get("verification") != "curator_checked":
        errs.append("'verification: curator_checked' can only be set by a curator during review; "
                    "use 'owner_verified' if you maintain this tool.")

    vals = validators()
    errs += schema_errors(etype, entry, vals)

    new_pubs = []
    if not errs:
        for doi in entry.get("publications", []):
            if doi.lower() != doi:
                errs.append(f"DOI {doi}: please write DOIs in lower case.")
            elif doi not in cat["publication"]:
                pub = crossref_publication(doi) if network else None
                if not pub:
                    errs.append(f"DOI {doi} is not in the catalogue and could not be resolved via Crossref.")
                else:
                    pub["provenance"] = {"source": "submission (Crossref)", "added": today, "issue": issue}
                    errs += [f"publication {doi}: {e}" for e in schema_errors("publication", pub, vals)]
                    new_pubs.append(pub)

    if not errs:
        trial = copy.deepcopy(cat)
        trial[etype][key] = {**entry, "_path": f"catalogue/{folder}/{entry_filename(etype, entry)}"}
        for p in new_pubs:
            trial["publication"][p["doi"]] = {**p, "_path": f"catalogue/publications/{entry_filename('publication', p)}"}
        errs += reference_errors(trial)

    if errs:
        summary["errors"] = errs
        return summary

    files = [(etype, entry)] + [("publication", p) for p in new_pubs]
    for t, e in files:
        path = CATALOGUE / TYPES[t][0] / entry_filename(t, e)
        if write:
            path.write_text(dump_yaml(normalize(t, e)), encoding="utf-8")
        summary["files"].append(str(path.relative_to(CATALOGUE.parent)))
    label = entry.get("name") or entry.get("title") or key
    verb = "Update" if existing else "Add"
    summary["entry"] = normalize(etype, entry)
    summary.update(ok=True, branch=f"submission/issue-{issue}",
                   title=f"{verb} {etype.replace('_', ' ')}: {label}"[:120])
    return summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--event")
    ap.add_argument("--body-file")
    ap.add_argument("--issue", type=int)
    ap.add_argument("--user")
    ap.add_argument("--summary", required=True)
    ap.add_argument("--no-network", action="store_true")
    a = ap.parse_args()
    if a.event:
        ev = json.load(open(a.event, encoding="utf-8"))["issue"]
        body, issue, user = ev.get("body") or "", ev["number"], ev["user"]["login"]
    else:
        body, issue, user = open(a.body_file, encoding="utf-8").read(), a.issue, a.user
    summary = process(body, issue, user, network=not a.no_network)
    json.dump(summary, open(a.summary, "w", encoding="utf-8"), indent=1)
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
