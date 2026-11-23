"""Built-in sample DEMs.

GeoTIFFs in sample_rasters/ (or /opt/sample-dem/ in the container) are the
choices. catalog.json can set a display name and a stable dataset id. A new
.tif dropped into that folder shows up without a code change. San Miguel keeps
the id "sample" so the precomputed HAND cache is reused.
"""

from __future__ import annotations

import json
import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path

from app.core.hand_generator import process_raster, read_curve
from app.core.storage import DATA_DIR, dataset_dir

_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


@dataclass(frozen=True)
class SampleChoice:
    id: str
    name: str
    path: Path
    note: str | None = None

    def as_dict(self) -> dict[str, str]:
        payload = {"id": self.id, "name": self.name}
        if self.note:
            payload["note"] = self.note
        return payload


def list_samples() -> list[SampleChoice]:
    found: dict[str, SampleChoice] = {}
    order: list[str] = []
    for root in _sample_roots():
        catalog = _read_catalog(root)
        paths = {path.name: path for path in sorted(root.glob("*.tif"))}
        names = [item["file"] for item in catalog if item["file"] in paths]
        names.extend(name for name in paths if name not in names)
        for filename in names:
            meta = next((item for item in catalog if item["file"] == filename), None)
            choice = _choice_for(paths[filename], meta)
            if choice.id in found:
                continue
            found[choice.id] = choice
            order.append(choice.id)
    extra = _env_sample()
    if extra is not None and extra.id not in found:
        found[extra.id] = extra
        order.append(extra.id)
    return [found[sample_id] for sample_id in order]


def ensure_sample(sample_id: str | None = None) -> dict:
    choices = list_samples()
    if not choices:
        raise ValueError("No sample DEMs were found in sample_rasters.")
    if sample_id is None:
        choice = next((item for item in choices if item.id == "sample"), choices[0])
    else:
        choice = next((item for item in choices if item.id == sample_id), None)
        if choice is None:
            raise ValueError(f"Unknown sample DEM: {sample_id}.")
    dest = dataset_dir(choice.id)
    curve_path = dest / "hypsometric.json"
    cog = dest / "hand_cog.tif"
    if curve_path.is_file() and cog.is_file():
        return read_curve(choice.id)
    return _build_sample(choice, dest)


def _build_sample(choice: SampleChoice, dest: Path) -> dict:
    work = DATA_DIR / "_work" / f"sample-build-{choice.id}"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    dem = work / "source_dem.tif"
    try:
        shutil.copyfile(choice.path, dem)
        if dest.exists():
            shutil.rmtree(dest)
        payload = process_raster(
            dem,
            dest,
            dataset_id=choice.id,
            source_kind="dem",
            source_name=choice.name,
            window=None,
            stream_threshold_km2=1.0,
            accum_threshold_cells=None,
        )
        shutil.copyfile(dem, dest / "source_dem.tif")
        payload["source_kind"] = "sample"
        (dest / "hypsometric.json").write_text(json.dumps(payload), encoding="utf-8")
        return payload
    except Exception:
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        raise
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _sample_roots() -> list[Path]:
    roots: list[Path] = []
    override = os.environ.get("SAMPLE_DEM_DIR")
    if override:
        roots.append(Path(override))
    roots.append(Path("/opt/sample-dem"))
    repo = _repo_sample_dir()
    if repo is not None:
        roots.append(repo)
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


def _repo_sample_dir() -> Path | None:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "sample_rasters"
        if candidate.is_dir():
            return candidate
    return None


def _read_catalog(root: Path) -> list[dict]:
    path = root / "catalog.json"
    if not path.is_file():
        return []
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError(f"{path} must be a list of sample entries.")
    entries: list[dict] = []
    for item in raw:
        if not isinstance(item, dict) or not isinstance(item.get("file"), str):
            raise ValueError(f"{path} entries need a file name.")
        entries.append(item)
    return entries


def _choice_for(path: Path, meta: dict | None) -> SampleChoice:
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
    if not _ID.fullmatch(sample_id):
        raise ValueError(f"Sample id {sample_id!r} must use letters, numbers, _ or -.")
    return SampleChoice(id=sample_id, name=name, path=path, note=note)


def _env_sample() -> SampleChoice | None:
    override = os.environ.get("SAMPLE_DEM")
    if not override:
        return None
    path = Path(override)
    if not path.is_file():
        raise ValueError(f"SAMPLE_DEM is not a file: {path}")
    return _choice_for(path, None)


def _label_from_stem(stem: str) -> str:
    words = [word for word in stem.replace("-", " ").replace("_", " ").split() if word]
    if not words:
        return "Sample"
    return " ".join(word.upper() if len(word) <= 2 else word.capitalize() for word in words)


if __name__ == "__main__":
    for item in list_samples():
        print(item.id, item.name, item.path)
