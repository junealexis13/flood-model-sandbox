"""Local dataset paths. Swap this root for object storage later."""

from __future__ import annotations

import os
import re
from pathlib import Path

DATA_DIR = Path(
    os.environ.get("DATA_DIR", Path(__file__).resolve().parents[2] / "data")
).resolve()

_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_UPLOAD_BYTES = 250 * 1024 * 1024


def ensure_data_dir() -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return DATA_DIR


def dataset_dir(dataset_id: str) -> Path:
    if not _ID.fullmatch(dataset_id) or dataset_id.startswith("."):
        raise ValueError("Unknown dataset.")
    return DATA_DIR / dataset_id


def incoming_dir(upload_id: str) -> Path:
    if not _ID.fullmatch(upload_id):
        raise ValueError("Unknown upload.")
    return DATA_DIR / "_incoming" / upload_id
