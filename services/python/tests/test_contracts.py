from pathlib import Path

import pytest

from harness_py import load_schema, required_fields


def test_event_envelope_contract_matches_p00_spec() -> None:
    snapshot = load_schema("EventEnvelope", 1)
    # P00 spec section 9: mandatory EventEnvelope fields.
    assert required_fields(snapshot) >= {
        "event_id",
        "schema_version",
        "event_type",
        "timestamp",
        "run_id",
        "trace_id",
        "payload",
    }


def test_run_contract_is_strict() -> None:
    snapshot = load_schema("Run", 1)
    assert snapshot.document.get("additionalProperties") is False
    assert "root_thread_id" in required_fields(snapshot)


def test_mismatched_snapshot_is_rejected(tmp_path: Path) -> None:
    (tmp_path / "Run.v1.json").write_text('{"title": "Run", "x-version": 2}', encoding="utf-8")
    with pytest.raises(ValueError, match="do not match"):
        load_schema("Run", 1, schemas_dir=tmp_path)


def test_missing_snapshot_is_an_error(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        load_schema("Nope", 1, schemas_dir=tmp_path)
