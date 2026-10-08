# Contributing

Thank you for helping to map data science tools for emerging substances!

## For contributors

**Easiest:** on the website use **+ Propose** (new tool, research question or dataset) or **Suggest edit** on any entry.
The form creates the entry and opens a pre-filled GitHub issue — review it and click *Submit new issue*.
You need a free GitHub account.

What happens next:

1. A bot checks the entry within a minute. If something is wrong it comments on your issue; **edit the issue** and it re-checks.
2. If the entry is valid, the bot opens a pull request and links it in your issue. You are credited as co-author.
3. A curator reviews it, may ask questions in the pull request, and merges it. Your issue closes automatically.
4. The website updates a few minutes later; the change appears in the entry's history.

Alternatives:

- **Directly on GitHub:** *Issues → New issue* and choose a template; or edit a YAML file in `catalogue/` with
  GitHub's pencil button (this creates a pull request from your fork).
- **No GitHub account:** send your entry to the WG coordinators; a curator submits it with *On behalf of* filled in.

Guidelines:

- One entry per tool, model or resource; cite peer-reviewed publications by DOI (publication details are fetched automatically).
- Use `verification: owner_verified` only if you develop or maintain the tool.
- List people as `contacts` only with their consent.
- IDs are permanent: lower-case words separated by `-`.

## For curators

Review each `needs-curator` pull request:

- [ ] in scope (data science / AI relevant to emerging substances) and factually plausible
- [ ] categories sensible (endpoints, research questions, maturity)
- [ ] contacts have agreed to be listed
- [ ] set `verification: curator_checked` if you checked the entry (edit the file in the pull request)

Then approve and merge (squash or merge commit both keep the co-author credit). Changes to `vocab.yaml`, the schemas
or research-question priorities affect everyone — discuss them in an issue first.

The submission bot treats issue text as untrusted: it parses YAML safely, validates against the schema, and writes only
to `catalogue/<type>/<id>.yaml`. Pull requests from forks are validated by the *Validate catalogue* workflow.
