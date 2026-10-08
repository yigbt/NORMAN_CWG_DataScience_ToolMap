"""One-off seeding of the catalogue from the 2025 NORMAN DS WG survey.

Usage:
  python scripts/seed_from_survey.py <survey.xlsx> <q7_publications.csv> [--force]

Inputs: the raw survey export (for Q6/Q8 demand counts) and the Crossref cache of the Q7 DOIs.
The grouping of publications into tools and all category assignments come from seed/assignments.yaml
(hand-curated, reviewed by the WG coordinators). No entry is linked to an individual survey response.
Refuses to overwrite an existing catalogue unless --force is given.
"""
import sys
from datetime import date

import pandas as pd

from catalogue_lib import CATALOGUE, ROOT, TYPES, dump_yaml, entry_filename, load_yaml, normalize, validate_catalogue

# Same harmonisation as notebooks/survey_analysis.ipynb (Q6 write-in, Q8 typo of the form).
RENAME = {"Semi-quantification (but currently in development)": "Semi-quantification tools",
          "Toxicty predictions": "Toxicity predictions"}
Q6_TO_ENDPOINT = {
    "Tox predictions": "toxicity", "Persistence predictions": "persistence",
    "Bioaccumulation predictions": "bioaccumulation", "Transformation product predictions": "transformation_products",
    "Semi-quantification tools": "semi_quantification", "Chemical property predictions": "chemical_properties",
    "Analytical information predictions (e.g., retention time (RT), collision cross-section (CCS), ionization amenability)":
        "analytical_information",
    "Antimicrobial properties": "antimicrobial",
}
Q8_TO_ENDPOINT = {
    "Toxicity predictions": "toxicity", "Persistence predictions": "persistence",
    "Bioaccumulation predictions": "bioaccumulation", "Transformation product predictions": "transformation_products",
    "Semi-quantification": "semi_quantification", "Chemical property predictions": "chemical_properties",
    "Analytical information predictions (RT, CCS, amenability)": "analytical_information",
    "Antimicrobial properties": "antimicrobial",
}


def clean(s):
    return " ".join(str(s).replace("\xa0", " ").split())


def per_respondent(raw, col_prefix, mapping):
    """{endpoint: number of respondents}, counting each respondent once per endpoint."""
    col = next(c for c in raw.columns if clean(c).startswith(col_prefix))
    counts, n = {}, 0
    for v in raw[col].dropna():
        eps = {mapping.get(RENAME.get(clean(t), clean(t))) for t in str(v).split(";")} - {None}
        n += 1
        for ep in eps:
            counts[ep] = counts.get(ep, 0) + 1
    return counts, n


def main(xlsx, pubs_csv, force=False):
    if any(any((CATALOGUE / TYPES[t][0]).glob("*.yaml")) for t in TYPES) and not force:
        sys.exit("Catalogue is not empty; refusing to overwrite (use --force).")
    raw = pd.read_excel(xlsx)
    have, _ = per_respondent(raw, "Have you or your team developed data science tools", Q6_TO_ENDPOINT)
    need, n_q8 = per_respondent(raw, "What are the most urgent research questions", Q8_TO_ENDPOINT)

    spec = load_yaml((ROOT / "seed" / "assignments.yaml").read_text(encoding="utf-8"))
    today = date.today().isoformat()
    prov = {"source": "survey-2025", "added": today}
    out = {t: [] for t in TYPES}

    for rq in spec["research_questions"]:
        rq = dict(rq)
        ep = rq.get("endpoint")
        if rq["category"] == "prediction" and ep in Q8_TO_ENDPOINT.values():
            rq["survey_demand"] = {"q8_need": need.get(ep, 0), "q6_have_tool": have.get(ep, 0),
                                   "q8_respondents": n_q8}
        rq["roadmap"] = {"status": "not_started", "priority": rq.pop("priority"), "updated": today}
        rq["provenance"] = prov
        out["research_question"].append(rq)

    rq_by_endpoint = {rq["endpoint"]: rq["id"] for rq in spec["research_questions"] if rq.get("endpoint")}
    used = set()
    for tool in spec["tools"]:
        rqs = [rq_by_endpoint[e] for e in tool["endpoints"] if e in rq_by_endpoint]
        rqs += [r for r in tool.pop("extra_research_questions", []) if r not in rqs]
        entry = {"id": tool["id"], "name": tool["name"], "kind": tool["kind"], "description": tool["description"],
                 "endpoints": tool["endpoints"], "research_questions": rqs}
        for k in ("methods", "input_data", "availability", "url", "code_url", "publications"):
            if tool.get(k):
                entry[k] = tool[k]
        entry |= {"maturity": tool.get("maturity", "published"), "verification": "seeded_unverified",
                  "provenance": {"source": "survey-2025-Q7", "added": today}}
        used.update(tool.get("publications", []))
        out["tool"].append(entry)

    pubs = pd.read_csv(pubs_csv)
    for _, p in pubs.iterrows():
        if p["doi"] not in used:
            sys.exit(f"Publication {p['doi']} is not assigned to any tool in seed/assignments.yaml")
        out["publication"].append({"doi": p["doi"], "title": p["title"], "authors": p["authors"],
                                   "journal": p["journal"], "year": int(p["year"]),
                                   "provenance": {"source": "survey-2025-Q7 (Crossref)", "added": today}})
    missing = used - set(pubs["doi"])
    if missing:
        sys.exit(f"DOIs in assignments.yaml without Crossref record: {sorted(missing)}")

    for etype, entries in out.items():
        for e in entries:
            (CATALOGUE / TYPES[etype][0] / entry_filename(etype, e)).write_text(dump_yaml(normalize(etype, e)), encoding="utf-8")
    errs = validate_catalogue()
    print(f"seeded: " + ", ".join(f"{len(v)} {k}" for k, v in out.items()))
    if errs:
        sys.exit("Validation errors:\n" + "\n".join(errs))


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--force"]
    main(*args, force="--force" in sys.argv)
