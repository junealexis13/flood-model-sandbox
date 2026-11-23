"""Job directory layout, atomic status persistence, and sample DEM discovery."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

FLOW_SIM_DATA_DIR = Path(
    os.environ.get("FLOW_SIM_DATA_DIR", Path(__file__).resolve().parents[1] / "data")
).resolve()

_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_UPLOAD_BYTES = 250 * 1024 * 1024


def ensure_data_dir() -> Path:
    FLOW_SIM_DATA_DIR.mkdir(parents=True, exist_ok=True)
    return FLOW_SIM_DATA_DIR


def job_dir(job_id: str) -> Path:
    if not _ID_RE.fullmatch(job_id) or job_id.startswith("."):
        raise ValueError("Invalid job identifier.")
    return FLOW_SIM_DATA_DIR / "jobs" / job_id


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    tmp.replace(path)


def write_status(
    directory: Path,
    *,
    job_id: str,
    state: str,
    progress: float,
    sim_time_sec: float = 0.0,
    duration_sec: float = 0.0,
    message: str = "",
    error: str | None = None,
    dem_name: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "job_id": job_id,
        "state": state,
        "progress": round(max(0.0, min(100.0, float(progress))), 2),
        "sim_time_sec": round(max(0.0, float(sim_time_sec)), 3),
        "duration_sec": round(max(0.0, float(duration_sec)), 3),
        "message": message,
        "error": error,
        "dem_name": dem_name,
        "updated_at": now_iso(),
    }
    write_json_atomic(directory / "status.json", payload)
    return payload


def read_status(job_id: str) -> dict[str, Any]:
    path = job_dir(job_id) / "status.json"
    if not path.is_file():
        raise FileNotFoundError(job_id)
    return json.loads(path.read_text(encoding="utf-8"))


@dataclass(frozen=True)
class SampleChoice:
    id: str
    name: str
    path: Path
    note: str | None = None

    def as_dict(self) -> dict[str, str]:
        data = {"id": self.id, "name": self.name}
        if self.note:
            data["note"] = self.note
        return data


def list_samples() -> list[SampleChoice]:
    found: dict[str, SampleChoice] = {}
    order: list[str] = []
    for root in _sample_roots():
        catalog = _read_catalog(root)
        paths = {p.name: p for p in sorted(root.glob("*.tif"))}
        paths.update({p.name: p for p in sorted(root.glob("*.asc"))})
        names = [item["file"] for item in catalog if item["file"] in paths]
        names.extend(name for name in paths if name not in names)
        for filename in names:
            meta = next((item for item in catalog if item["file"] == filename), None)
            choice = _choice_for(paths[filename], meta)
            if choice.id in found:
                continue
            found[choice.id] = choice
            order.append(choice.id)
    return [found[sample_id] for sample_id in order]


def resolve_sample_path(sample_id: str) -> SampleChoice:
    for choice in list_samples():
        if choice.id == sample_id:
            return choice
    raise FileNotFoundError(f"Unknown sample DEM: {sample_id}")


def _sample_roots() -> list[Path]:
    roots: list[Path] = []
    override = os.environ.get("SAMPLE_DEM_DIR")
    if override:
        roots.append(Path(override))
    roots.append(Path("/opt/sample-dem"))
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "sample_rasters"
        if candidate.is_dir():
            roots.append(candidate)
            break
    unique: list[Path] = []
    seen: set[Path] = set()
    for root in roots:
        try:
            resolved = root.resolve()
        except OSError:
            continue
        if resolved in seen or not resolved.is_dir():
            continue
        seen.add(resolved)
        unique.append(resolved)
    return unique


def _read_catalog(root: Path) -> list[dict[str, Any]]:
    path = root / "catalog.json"
    if not path.is_file():
        return []
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict) and isinstance(item.get("file"), str)]


def _choice_for(path: Path, meta: dict[str, Any] | None) -> SampleChoice:
    stem = path.stem
    sample_id = stem
    name = _label_from_stem(stem)
    note = None
    if meta:
        if isinstance(meta.get("id"), str) and meta["id"].strip():
            sample_id = meta["id"].strip()
        if isinstance(meta.get("name"), str) and meta["name"].strip():
            name = meta["name"].strip()
        if isinstance(meta.get("note"), str) and meta["note"].strip():
            note = meta["note"].strip()
    return SampleChoice(id=sample_id, name=name, path=path, note=note)


def _label_from_stem(stem: str) -> str:
    words = [w for w in stem.replace("-", " ").replace("_", " ").split() if w]
    if not words:
        return "Sample"
    return " ".join(w.upper() if len(w) <= 2 else w.capitalize() for w in words)
