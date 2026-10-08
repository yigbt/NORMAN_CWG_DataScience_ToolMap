import json

from jsonschema import Draft202012Validator

from catalogue_lib import SCHEMA_DIR, TYPES, load_catalogue, load_schemas, load_vocab, validate_catalogue


def test_schemas_are_valid_json_schema():
    for etype, schema in load_schemas().items():
        Draft202012Validator.check_schema(schema)


def test_every_vocab_reference_exists():
    vocab = load_vocab()
    for _, fname, _ in TYPES.values():
        text = (SCHEMA_DIR / fname).read_text()
        for ref in [part.split('"')[0] for part in text.split('"$vocab": "')[1:]]:
            assert ref in vocab, f"{fname} references unknown vocabulary '{ref}'"


def test_catalogue_is_valid():
    assert validate_catalogue() == []


def test_seeded_entries_are_flagged_and_linked():
    cat = load_catalogue()
    for t in cat["tool"].values():
        assert t["research_questions"], f"{t['id']} is not linked to any research question"
        if t["provenance"]["source"].startswith("survey-2025"):
            assert t["verification"] == "seeded_unverified"


def test_vocab_labels_are_strings():
    for name, terms in load_vocab().items():
        assert all(isinstance(k, str) and isinstance(v, str) for k, v in terms.items()), name
