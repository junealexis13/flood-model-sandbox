"""Built-in sample DEMs.

GeoTIFFs in sample_rasters/ (or /opt/sample-dem/ in the container) are the
choices. catalog.json can set a display name and a stable dataset id. A new
.tif dropped into that folder shows up without a code change. San Miguel keeps
the id "sample" so the precomputed HAND cache is reused.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path

import rasterio

from app.core.hand_generator import (
    MAX_SCENE,
    SceneWindow,
    inspect_raster,
    needs_crop,
    process_raster,
    read_curve,
)
from app.core.storage import DATA_DIR, dataset_dir

_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


@dataclass(frozen=True)
class SampleChoice:
    id: str
    name: str
    path: Path
    note: str | None = None
    width: int | None = None
    height: int | None = None
    needs_crop: bool = False
    max_scene: int = MAX_SCENE

    def as_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "id": self.id,
            "name": self.name,
            "needs_crop": self.needs_crop,
            "max_scene": self.max_scene,
        }
        if self.note:
            payload["note"] = self.note
        if self.width is not None and self.height is not None:
            payload["width"] = self.width
            payload["height"] = self.height
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


def resolve_sample(sample_id: str | None = None) -> SampleChoice:
    choices = list_samples()
    if not choices:
        raise ValueError("No sample DEMs were found in sample_rasters.")
    if sample_id is None:
        return next((item for item in choices if item.id == "sample"), choices[0])
    choice = next((item for item in choices if item.id == sample_id), None)
    if choice is None:
        raise ValueError(f"Unknown sample DEM: {sample_id}.")
    return choice


def _sample_preview_file(sample_id: str) -> Path:
    if not _ID.fullmatch(sample_id):
        raise ValueError(f"Unknown sample DEM: {sample_id}.")
    return DATA_DIR / "_sample_previews" / f"{sample_id}.png"


def inspect_sample(sample_id: str, stream_threshold_km2: float = 1.0) -> dict:
    choice = resolve_sample(sample_id)
    preview_path = _sample_preview_file(choice.id)
    return inspect_raster(
        choice.path,
        preview_path,
        source_name=choice.name,
        stream_threshold_km2=stream_threshold_km2,
        preview_url=f"/api/samples/{choice.id}/preview",
        extra={"sample_id": choice.id},
        reuse_preview=True,
    )


def sample_preview_path(sample_id: str) -> Path:
    choice = resolve_sample(sample_id)
    preview_path = _sample_preview_file(choice.id)
    if (
        not preview_path.is_file()
        or preview_path.stat().st_mtime < choice.path.stat().st_mtime
    ):
        inspect_sample(choice.id)
    return preview_path


def _cropped_dataset_id(
    sample_id: str,
    window: SceneWindow,
    stream_threshold_km2: float,
    accum_threshold_cells: float | None,
) -> str:
    key = (
        f"{sample_id}:{window.col}:{window.row}:{window.width}:{window.height}:"
        f"{stream_threshold_km2:.6f}:{accum_threshold_cells}"
    )
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:10]
    prefix = sample_id[:52]
    return f"{prefix}_{digest}"


def ensure_sample(
    sample_id: str | None = None,
    *,
    window: SceneWindow | None = None,
    stream_threshold_km2: float = 1.0,
    accum_threshold_cells: float | None = None,
) -> dict:
    choice = resolve_sample(sample_id)
    if window is None and accum_threshold_cells is None and abs(stream_threshold_km2 - 1.0) < 1e-9:
        dataset_id = choice.id
    elif window is not None:
        dataset_id = _cropped_dataset_id(
            choice.id, window, stream_threshold_km2, accum_threshold_cells
        )
    else:
        key = f"{choice.id}:full:{stream_threshold_km2:.6f}:{accum_threshold_cells}"
        digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:10]
        dataset_id = f"{choice.id[:52]}_{digest}"

    dest = dataset_dir(dataset_id)
    curve_path = dest / "hypsometric.json"
    cog = dest / "hand_cog.tif"
    if curve_path.is_file() and cog.is_file():
        curve = read_curve(dataset_id)
        curve.setdefault("sample_id", choice.id)
        return curve
    return _build_sample(
        choice,
        dest,
        dataset_id=dataset_id,
        window=window,
        stream_threshold_km2=stream_threshold_km2,
        accum_threshold_cells=accum_threshold_cells,
    )


def _build_sample(
    choice: SampleChoice,
    dest: Path,
    *,
    dataset_id: str,
    window: SceneWindow | None,
    stream_threshold_km2: float,
    accum_threshold_cells: float | None,
) -> dict:
    work = DATA_DIR / "_work" / f"sample-build-{dataset_id}"
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
            dataset_id=dataset_id,
            source_kind="dem",
            source_name=choice.name,
            window=window,
            stream_threshold_km2=stream_threshold_km2,
            accum_threshold_cells=accum_threshold_cells,
        )
        if window is None:
            shutil.copyfile(dem, dest / "source_dem.tif")
        payload["source_kind"] = "sample"
        payload["sample_id"] = choice.id
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


def _raster_dimensions(path: Path) -> tuple[int | None, int | None]:
    try:
        with rasterio.open(path) as src:
            return int(src.width), int(src.height)
    except Exception:
        return None, None


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
    width, height = _raster_dimensions(path)
    oversized = width is not None and height is not None and needs_crop(width, height)
    return SampleChoice(
        id=sample_id,
        name=name,
        path=path,
        note=note,
        width=width,
        height=height,
        needs_crop=oversized,
        max_scene=MAX_SCENE,
    )


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
