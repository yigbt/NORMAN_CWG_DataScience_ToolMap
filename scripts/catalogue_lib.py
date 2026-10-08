"""Shared helpers: load vocabularies/schemas, read the YAML catalogue, validate entries and cross-references."""
import copy
import json
import re
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[1]
CATALOGUE = ROOT / "catalogue"
SCHEMA_DIR = ROOT / "schema"

# entity type -> (catalogue sub-folder, schema file, id field)
TYPES = {
    "tool": ("tools", "tool.schema.json", "id"),
    "research_question": ("research_questions", "research_question.schema.json", "id"),
    "publication": ("publications", "publication.schema.json", "doi"),
    "dataset": ("datasets", "dataset.schema.json", "id"),
}


class _StrDateLoader(yaml.SafeLoader):
    """SafeLoader that keeps ISO dates as strings (the schemas expect strings)."""


_StrDateLoader.yaml_implicit_resolvers = {
    k: [(tag, rx) for tag, rx in v if tag != "tag:yaml.org,2002:timestamp"]
    for k, v in yaml.SafeLoader.yaml_implicit_resolvers.items()}


def load_yaml(text):
    return yaml.load(text, Loader=_StrDateLoader)


def doi_slug(doi):
    return re.sub(r"[^a-z0-9]+", "-", doi.lower()).strip("-")


def entry_filename(etype, entry):
    key = entry[TYPES[etype][2]]
    return (doi_slug(key) if etype == "publication" else key) + ".yaml"


def load_vocab():
    return load_yaml((ROOT / "vocab.yaml").read_text(encoding="utf-8"))


def _resolve_vocab(node, vocab):
    if isinstance(node, dict):
        if "$vocab" in node:
            return {"type": "string", "enum": list(vocab[node["$vocab"]])}
        return {k: _resolve_vocab(v, vocab) for k, v in node.items()}
    if isinstance(node, list):
        return [_resolve_vocab(v, vocab) for v in node]
    return node


def load_schemas(vocab=None):
    """Schemas with {"$vocab": name} replaced by enums, keyed by entity type."""
    vocab = vocab or load_vocab()
    return {etype: _resolve_vocab(json.loads((SCHEMA_DIR / fname).read_text()), vocab)
            for etype, (_, fname, _) in TYPES.items()}


def validators(schemas=None):
    schemas = schemas or load_schemas()
    registry = Registry().with_resources(
        (TYPES[t][1], Resource.from_contents(s)) for t, s in schemas.items())
    return {t: Draft202012Validator(s, registry=registry, format_checker=FormatChecker())
            for t, s in schemas.items()}


def schema_errors(etype, entry, vals=None):
    vals = vals or validators()
    return [f"{'/'.join(map(str, e.absolute_path)) or '(root)'}: {e.message}"
            for e in sorted(vals[etype].iter_errors(entry), key=lambda e: list(e.absolute_path))]


def dump_yaml(entry):
    return yaml.safe_dump(entry, sort_keys=False, allow_unicode=True, width=100)


def load_catalogue(root=CATALOGUE):
    """{etype: {key: entry}} plus the file path of each entry under '_path'."""
    cat = {}
    for etype, (folder, _, key) in TYPES.items():
        cat[etype] = {}
        for p in sorted((root / folder).glob("*.yaml")):
            entry = load_yaml(p.read_text(encoding="utf-8")) or {}
            entry["_path"] = str(p.relative_to(root.parent))
            cat[etype][entry.get(key, p.stem)] = entry
    return cat


def strip_private(entry):
    return {k: v for k, v in entry.items() if not k.startswith("_")}


def reference_errors(cat):
    """Cross-reference and naming checks across the whole catalogue."""
    errs = []
    rqs, pubs = set(cat["research_question"]), set(cat["publication"])
    for etype, entries in cat.items():
        for key, e in entries.items():
            where = e.get("_path", f"{etype}:{key}")
            if Path(where).name != entry_filename(etype, e):
                errs.append(f"{where}: file name should be {entry_filename(etype, e)}")
            for rq in e.get("research_questions", []):
                if rq not in rqs:
                    errs.append(f"{where}: unknown research question '{rq}'")
            for doi in e.get("publications", []):
                if doi not in pubs:
                    errs.append(f"{where}: publication {doi} has no entry in catalogue/publications/")
    return errs


def validate_catalogue(cat=None):
    cat = cat or load_catalogue()
    vals = validators()
    errs = []
    for etype, entries in cat.items():
        for e in entries.values():
            errs += [f"{e['_path']}: {m}" for m in schema_errors(etype, strip_private(copy.deepcopy(e)), vals)]
    return errs + reference_errors(cat)


def _fetch_json(url, accept, timeout):
    import urllib.error
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "NORMAN-DS-tool-map/1.0", "Accept": accept})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except (urllib.error.URLError, TimeoutError, ValueError):
        return None


def doi_publication(doi, timeout=20):
    """(publication entry without provenance, metadata source) for a DOI, or (None, None) if it does not resolve.

    Crossref covers most journal articles; other registration agencies (DataCite: Zenodo, figshare, ...) are
    reached through doi.org content negotiation, which returns the same CSL-JSON structure."""
    import html
    import urllib.parse

    def clean(s):
        if isinstance(s, list):
            s = s[0] if s else ""
        return " ".join(html.unescape(re.sub(r"<[^>]+>", "", s or "")).split())

    quoted = urllib.parse.quote(doi)
    m, source = (_fetch_json(f"https://api.crossref.org/works/{quoted}", "application/json", timeout) or {}).get(
        "message"), "Crossref"
    if not isinstance(m, dict):
        m, source = _fetch_json(f"https://doi.org/{quoted}", "application/vnd.citationstyles.csl+json",
                                timeout), "doi.org"
    if not isinstance(m, dict) or not m.get("title"):
        return None, None
    names = [f"{a['family']}, {a['given'][:1]}." if a.get("given") and a.get("family")
             else a.get("family") or a.get("literal") or a.get("name", "")
             for a in m.get("author", []) if isinstance(a, dict)]
    authors = "; ".join(names[:3]) + " et al." if len(names) > 4 else "; ".join(names)
    year = ((m.get("issued") or {}).get("date-parts") or [[None]])[0][0]
    pub = {"doi": str(m.get("DOI") or doi).lower(), "title": clean(m.get("title"))[:500],
           "authors": clean(authors)[:500],
           "journal": clean(m.get("container-title") or m.get("publisher"))[:200], "year": year}
    return {k: v for k, v in pub.items() if v not in ("", None)}, source


def normalize(etype, entry, schemas=None, vocab=None):
    """Canonical form for clean diffs: keys in schema order, enum lists in vocabulary order."""
    schemas = schemas or load_schemas(vocab)
    props = schemas[etype]["properties"]

    def order(obj, spec_props):
        out = {k: obj[k] for k in spec_props if k in obj}
        out |= {k: v for k, v in obj.items() if k not in out}  # unknown keys keep their place at the end
        for k, v in out.items():
            spec = spec_props.get(k, {})
            enum = (spec.get("items") or {}).get("enum")
            if isinstance(v, list) and enum:
                out[k] = sorted(v, key=lambda x: enum.index(x) if x in enum else len(enum))
            elif isinstance(v, dict) and "properties" in spec:
                out[k] = order(v, spec["properties"])
        return out

    return order(entry, props)
