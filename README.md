# NORMAN Data Science Tool Map

A browser-based catalogue and map of data science and AI tools for monitoring emerging environmental substances,
maintained by the NORMAN Data Science working group. It answers two questions from the WG survey (Nov 2025):
*which tools exist?* and *which research questions do they address, and where are the gaps?*

**Website:** https://yigbt.github.io/NORMAN_CWG_DataScience_ToolMap/

**Views:** Catalogue (filterable cards) · Questions × tools (matrix) · Network (graph) · Roadmap & gaps.

## How it works

```
Participant ── form on the website ──► pre-filled GitHub issue
                                         │  bot: parse → validate → YAML file
                                         ▼
                                       pull request ── curator reviews & merges
                                         │
Website ◄── build: YAML + git history ◄──┘ (push to main)
```

- **The YAML files in `catalogue/` are the data.** Git history, issues and pull requests are the audit trail:
  every change records who proposed it, who approved it, when, and the discussion. The site shows this history per entry.
- **Nothing goes live without curator approval** (branch protection + `CODEOWNERS`).
- No server or database: GitHub Pages hosts the static site; GitHub Actions do validation and deployment.

## Repository layout

| Path | Content |
|---|---|
| `catalogue/tools/`, `research_questions/`, `publications/`, `datasets/` | One YAML file per entry |
| `schema/*.schema.json` | JSON Schemas; `{"$vocab": name}` refers to `vocab.yaml` |
| `vocab.yaml` | Controlled vocabularies (endpoints, kinds, maturity, …) |
| `config.yaml` | Site title and GitHub repository name |
| `scripts/build.py` | Validates everything and writes `site/data/catalogue.json` (with git history) |
| `scripts/issue_to_entry.py` | Used by the submission bot: issue → validated YAML |
| `scripts/seed_from_survey.py`, `seed/assignments.yaml` | One-off initial seeding from the survey |
| `site/` | The static website (vanilla JS; Cytoscape.js and js-yaml from cdnjs) |
| `.github/` | Issue forms, workflows, CODEOWNERS |
| `tests/` | `pytest` suite |

## Local preview

```bash
pip install -r requirements.txt          # or: uv run --with-requirements requirements.txt …
python scripts/build.py                  # validate + write site/data/catalogue.json
python -m http.server -d site 8000       # open http://localhost:8000
pytest -q tests
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contributors and curators.

## Origin of the initial data

Seeded from the NORMAN DS WG survey (37 responses): research questions from the reported needs (Q8, Q9) and suggested
activities (Q5); tools from the publications respondents listed (Q7, metadata from Crossref). Categories were assigned
by the WG coordinators; no entry is linked to an individual survey response. Seeded tools are marked
*Seeded from survey – please verify* until a tool owner or curator confirms them.

## How to cite

If you use the tool map or its content, please cite:

> Schor, J., Kruve-Vill, A., & NORMAN Data Science Working Group (2026). *NORMAN Data Science Tool Map: a
> community-curated catalogue of data science and AI tools for monitoring emerging environmental substances.*
> https://github.com/yigbt/NORMAN_CWG_DataScience_ToolMap

GitHub's **Cite this repository** button (from [`CITATION.cff`](CITATION.cff)) provides APA and BibTeX formats.
When citing a specific state of the catalogue, add the date you accessed it or the commit/release you used.
When reusing a single tool entry, please also cite the tool's own publications listed in that entry.

Maintainers: Jana Schor ([ORCID 0000-0003-1200-6234](https://orcid.org/0000-0003-1200-6234)) and
Anneli Kruve-Vill ([ORCID 0000-0001-9725-3351](https://orcid.org/0000-0001-9725-3351)), coordinators of the
NORMAN Data Science Working Group.

## License

| Part | License |
|---|---|
| Catalogue content: `catalogue/`, `vocab.yaml`, `schema/`, and the published `data/catalogue.json` | [CC BY 4.0](LICENSE-DATA) — free to share and adapt with attribution |
| Source code: `scripts/`, `site/` (except `site/data/`), `tests/`, `.github/` | [MIT](LICENSE) |

Contributions submitted through issues or pull requests are published under these same licenses.
Bibliographic metadata of publications comes from Crossref and is factual information.
