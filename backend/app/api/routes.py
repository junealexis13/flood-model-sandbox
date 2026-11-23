"""Dataset upload, scene crop, and file serving.

Rainfall, curve number, and stage are not computed here. The browser solves
those from hypsometric.json while the sliders move.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.core.hand_generator import (
    NoStreamError,
    SceneWindow,
    inspect_upload,
    list_curves,
    process_raster,
    read_curve,
    summary_from_curve,
)
from app.core.sample_basin import (
    ensure_sample,
    inspect_sample,
    list_samples,
    sample_preview_path,
)
from app.core.storage import MAX_UPLOAD_BYTES, dataset_dir, ensure_data_dir, incoming_dir

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/datasets")
def list_datasets() -> list[dict]:
    return [summary_from_curve(curve) for curve in list_curves()]


@router.get("/datasets/{dataset_id}")
def get_dataset(dataset_id: str) -> dict:
    try:
        return summary_from_curve(read_curve(dataset_id))
    except (FileNotFoundError, ValueError) as exc:
        _raise(exc)


@router.get("/datasets/{dataset_id}/hypsometric")
def get_hypsometric(dataset_id: str):
    try:
        path = dataset_dir(dataset_id) / "hypsometric.json"
    except ValueError as exc:
        _raise(exc)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Dataset not found.")
    return FileResponse(path, media_type="application/json")


@router.get("/datasets/{dataset_id}/hand")
def get_hand(dataset_id: str):
    try:
        path = dataset_dir(dataset_id) / "hand_cog.tif"
    except ValueError as exc:
        _raise(exc)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="HAND raster not found.")
    return FileResponse(path, media_type="image/tiff")


@router.get("/samples")
def get_samples() -> list[dict]:
    try:
        return [choice.as_dict() for choice in list_samples()]
    except Exception as exc:
        _raise(exc)


@router.get("/samples/{sample_id}/inspect")
async def get_sample_inspect(
    sample_id: str,
    stream_threshold_km2: float = 1.0,
) -> dict:
    try:
        return await asyncio.to_thread(inspect_sample, sample_id, stream_threshold_km2)
    except Exception as exc:
        _raise(exc)


@router.get("/samples/{sample_id}/preview")
def get_sample_preview(sample_id: str):
    try:
        path = sample_preview_path(sample_id)
    except Exception as exc:
        _raise(exc)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Sample preview not found.")
    return FileResponse(path, media_type="image/png")


@router.post("/datasets/sample")
async def load_sample(
    sample_id: str | None = None,
    col: int | None = None,
    row: int | None = None,
    width: int | None = None,
    height: int | None = None,
    stream_threshold_km2: float = 1.0,
    accum_threshold_cells: float | None = None,
) -> dict:
    try:
        window = _window_from_form(col, row, width, height)
        curve = await asyncio.to_thread(
            ensure_sample,
            sample_id,
            window=window,
            stream_threshold_km2=stream_threshold_km2,
            accum_threshold_cells=accum_threshold_cells,
        )
    except Exception as exc:
        _raise(exc)
    return summary_from_curve(curve)


@router.post("/uploads")
async def create_upload(
    file: UploadFile = File(...),
    stream_threshold_km2: float = Form(1.0),
) -> dict:
    upload_id = uuid.uuid4().hex
    folder = incoming_dir(upload_id)
    folder.mkdir(parents=True, exist_ok=True)
    src = folder / "source.tif"
    try:
        await _save_upload(file, src)
        meta = await asyncio.to_thread(
            inspect_upload,
            src,
            upload_id,
            _clean_name(file.filename),
            stream_threshold_km2,
        )
    except Exception as exc:
        shutil.rmtree(folder, ignore_errors=True)
        _raise(exc)
    return meta


@router.get("/uploads/{upload_id}/preview")
def upload_preview(upload_id: str):
    try:
        path = incoming_dir(upload_id) / "preview.png"
    except ValueError as exc:
        _raise(exc)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Upload preview not found.")
    return FileResponse(path, media_type="image/png")


@router.post("/datasets")
async def create_dataset(
    kind: str = Form(...),
    upload_id: str | None = Form(None),
    stream_threshold_km2: float = Form(1.0),
    accum_threshold_cells: float | None = Form(None),
    col: int | None = Form(None),
    row: int | None = Form(None),
    width: int | None = Form(None),
    height: int | None = Form(None),
    file: UploadFile | None = File(None),
) -> dict:
    if kind not in {"hand", "dem"}:
        raise HTTPException(status_code=400, detail="kind must be 'hand' or 'dem'.")
    ensure_data_dir()
    owned_upload: Path | None = None
    try:
        window = _window_from_form(col, row, width, height)
        if upload_id:
            src = incoming_dir(upload_id) / "source.tif"
            if not src.is_file():
                raise HTTPException(status_code=404, detail="Upload not found. Choose the GeoTIFF again.")
            source_name = upload_id
            meta_name = src.parent / "name.txt"
            if meta_name.is_file():
                source_name = meta_name.read_text(encoding="utf-8").strip() or source_name
        elif file is not None:
            owned_upload = incoming_dir(uuid.uuid4().hex)
            owned_upload.mkdir(parents=True, exist_ok=True)
            src = owned_upload / "source.tif"
            await _save_upload(file, src)
            source_name = _clean_name(file.filename)
        else:
            raise HTTPException(status_code=400, detail="Choose a GeoTIFF or send an upload id.")

        dataset_id = uuid.uuid4().hex[:16]
        out_dir = dataset_dir(dataset_id)
        try:
            curve = await asyncio.to_thread(
                process_raster,
                src,
                out_dir,
                dataset_id=dataset_id,
                source_kind=kind,
                source_name=source_name,
                window=window,
                stream_threshold_km2=stream_threshold_km2,
                accum_threshold_cells=accum_threshold_cells,
            )
        except Exception:
            shutil.rmtree(out_dir, ignore_errors=True)
            raise
    except HTTPException:
        raise
    except Exception as exc:
        _raise(exc)
    finally:
        if owned_upload is not None:
            shutil.rmtree(owned_upload, ignore_errors=True)
    return summary_from_curve(curve)


async def _save_upload(file: UploadFile, dest: Path) -> None:
    size = 0
    try:
        with dest.open("wb") as handle:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise ValueError("GeoTIFF exceeds the 250 MB upload limit.")
                handle.write(chunk)
    except Exception:
        dest.unlink(missing_ok=True)
        raise
    finally:
        await file.close()
    if size == 0:
        dest.unlink(missing_ok=True)
        raise ValueError("The uploaded file is empty.")
    name_path = dest.parent / "name.txt"
    name_path.write_text(_clean_name(file.filename), encoding="utf-8")


def _window_from_form(
    col: int | None,
    row: int | None,
    width: int | None,
    height: int | None,
) -> SceneWindow | None:
    values = (col, row, width, height)
    if all(value is None for value in values):
        return None
    if any(value is None for value in values):
        raise ValueError("A crop window needs column, row, width, and height together.")
    return SceneWindow(int(col), int(row), int(width), int(height))


def _clean_name(name: str | None) -> str:
    raw = (name or "raster.tif").replace("\\", "/").split("/")[-1]
    cleaned = "".join(ch if ch.isalnum() or ch in "._- " else "_" for ch in raw).strip()
    return cleaned[:120] or "raster.tif"


def _raise(exc: Exception) -> None:
    if isinstance(exc, HTTPException):
        raise exc
    if isinstance(exc, FileNotFoundError):
        raise HTTPException(status_code=404, detail="Dataset not found.") from exc
    if isinstance(exc, (ValueError, NoStreamError)):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    logger.exception("processing failed")
    raise HTTPException(status_code=500, detail=str(exc)) from exc
