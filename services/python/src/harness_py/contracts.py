"""Read-only access to the portable JSON Schema contract snapshots."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SCHEMAS_DIR = Path(__file__).resolve().parents[4] / "specs" / "schemas"


@dataclass(frozen=True)
class SchemaSnapshot:
    name: str
    version: int
    document: dict[str, Any]


def load_schema(name: str, version: int, schemas_dir: Path = SCHEMAS_DIR) -> SchemaSnapshot:
    """Load `<name>.v<version>.json`; raises ValueError on any inconsistency."""
    path = schemas_dir / f"{name}.v{version}.json"
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError(f"{path.name}: schema document must be an object")
    if document.get("x-version") != version or document.get("title") != name:
        raise ValueError(f"{path.name}: title/x-version do not match the file name")
    return SchemaSnapshot(name=name, version=version, document=document)


def required_fields(snapshot: SchemaSnapshot) -> frozenset[str]:
    required = snapshot.document.get("required", [])
    if not isinstance(required, list) or not all(isinstance(r, str) for r in required):
        raise ValueError(f"{snapshot.name}: 'required' must be a list of strings")
    return frozenset(required)
