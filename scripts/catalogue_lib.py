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


def crossref_publication(doi, timeout=20):
    """Publication entry (without provenance) from Crossref, or None if the DOI does not resolve."""
    import html
    import urllib.error
    import urllib.parse
    import urllib.request

    def clean(s):
        return " ".join(html.unescape(re.sub(r"<[^>]+>", "", s or "")).split())

    req = urllib.request.Request(f"https://api.crossref.org/works/{urllib.parse.quote(doi)}",
                                 headers={"User-Agent": "NORMAN-DS-tool-map/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            m = json.load(r)["message"]
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError):
        return None
    names = [f"{a['family']}, {a['given'][:1]}." if a.get("given") else a.get("family", a.get("name", ""))
             for a in m.get("author", [])]
    authors = "; ".join(names[:3]) + " et al." if len(names) > 4 else "; ".join(names)
    year = ((m.get("issued") or {}).get("date-parts") or [[None]])[0][0]
    return {"doi": m.get("DOI", doi).lower(), "title": clean((m.get("title") or [""])[0])[:500],
            "authors": clean(authors)[:500], "journal": clean((m.get("container-title") or [""])[0])[:200],
            "year": year}


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
