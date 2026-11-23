"""FastAPI routes for submitting, polling, and streaming ANUGA 2D flow simulations."""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.schemas import FlowSimResultMetadata, JobStatusResponse
from app.storage import (
    MAX_UPLOAD_BYTES,
    ensure_data_dir,
    job_dir,
    list_samples,
    read_status,
    resolve_sample_path,
    write_json_atomic,
    write_status,
)

logger = logging.getLogger(__name__)
router = APIRouter()

ALLOWED_SUFFIXES = {".tif", ".tiff", ".asc"}


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "anuga-flow-sim"}


@router.get("/samples")
def get_samples() -> list[dict[str, str]]:
    return [choice.as_dict() for choice in list_samples()]


@router.post("/jobs", status_code=202, response_model=JobStatusResponse)
async def create_job(
    rain_mm_hr: float = Form(60.0),
    duration_sec: float = Form(1800.0),
    yieldstep_sec: float = Form(60.0),
    mannings_n: float = Form(0.035),
    max_triangle_area: float | None = Form(None),
    boundary_mode: str = Form("open"),
    sample_id: str | None = Form(None),
    file: UploadFile | None = File(None),
) -> dict:
    if rain_mm_hr <= 0 or rain_mm_hr > 2000:
        raise HTTPException(status_code=400, detail="rain_mm_hr must be between 0 and 2000 mm/hr.")
    if duration_sec < 10 or duration_sec > 86400:
        raise HTTPException(status_code=400, detail="duration_sec must be between 10 and 86400 seconds.")
    if yieldstep_sec < 1 or yieldstep_sec > duration_sec:
        raise HTTPException(status_code=400, detail="yieldstep_sec must be between 1 and duration_sec.")
    if duration_sec / yieldstep_sec > 300:
        raise HTTPException(
            status_code=400,
            detail="Too many output frames (>300). Increase yieldstep_sec or shorten duration_sec.",
        )
    if mannings_n <= 0 or mannings_n > 1.0:
        raise HTTPException(status_code=400, detail="mannings_n must be between 0 and 1.0.")
    if max_triangle_area is not None and max_triangle_area <= 0:
        max_triangle_area = None
    if boundary_mode not in {"open", "closed"}:
        raise HTTPException(status_code=400, detail="boundary_mode must be 'open' or 'closed'.")

    if file is None and not sample_id:
        raise HTTPException(status_code=400, detail="Upload a DEM (.tif or .asc) or select a sample_id.")

    ensure_data_dir()
    job_id = uuid.uuid4().hex[:16]
    directory = job_dir(job_id)
    directory.mkdir(parents=True, exist_ok=True)

    try:
        if file is not None:
            raw_name = _clean_name(file.filename)
            suffix = Path(raw_name).suffix.lower()
            if suffix not in ALLOWED_SUFFIXES:
                raise HTTPException(
                    status_code=400,
                    detail="Unsupported DEM format. Upload a GeoTIFF (.tif, .tiff) or Esri ASCII (.asc).",
                )
            dem_dest = directory / f"input_dem{suffix}"
            await _save_upload(file, dem_dest)
            dem_name = raw_name
        else:
            assert sample_id is not None
            try:
                sample = resolve_sample_path(sample_id)
            except FileNotFoundError as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc
            suffix = sample.path.suffix.lower() or ".tif"
            dem_dest = directory / f"input_dem{suffix}"
            shutil.copyfile(sample.path, dem_dest)
            dem_name = sample.name

        config = {
            "job_id": job_id,
            "dem_path": str(dem_dest),
            "dem_name": dem_name,
            "rain_mm_hr": float(rain_mm_hr),
            "duration_sec": float(duration_sec),
            "yieldstep_sec": float(yieldstep_sec),
            "mannings_n": float(mannings_n),
            "max_triangle_area": float(max_triangle_area) if max_triangle_area is not None else None,
            "boundary_mode": boundary_mode,
        }
        write_json_atomic(directory / "config.json", config)
        status = write_status(
            directory,
            job_id=job_id,
            state="queued",
            progress=0.0,
            sim_time_sec=0.0,
            duration_sec=float(duration_sec),
            message="Simulation queued.",
            dem_name=dem_name,
        )
        _launch_worker(directory)
        return status
    except HTTPException:
        shutil.rmtree(directory, ignore_errors=True)
        raise
    except ValueError as exc:
        shutil.rmtree(directory, ignore_errors=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        shutil.rmtree(directory, ignore_errors=True)
        logger.exception("Failed to create flow-sim job")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/jobs/{job_id}/status", response_model=JobStatusResponse)
def get_job_status(job_id: str) -> dict:
    try:
        return read_status(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Simulation job not found.") from exc


@router.get("/jobs/{job_id}/result", response_model=FlowSimResultMetadata)
def get_job_result(job_id: str) -> dict:
    try:
        directory = job_dir(job_id)
        status = read_status(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Simulation job not found.") from exc

    if status.get("state") != "completed":
        raise HTTPException(
            status_code=409,
            detail=f"Job is not completed (current state: {status.get('state')}).",
        )
    result_path = directory / "result.json"
    if not result_path.is_file():
        raise HTTPException(status_code=404, detail="Result metadata not found.")
    return json.loads(result_path.read_text(encoding="utf-8"))


@router.get("/jobs/{job_id}/result/mesh.bin")
def get_job_mesh_binary(job_id: str):
    return _serve_binary(job_id, "mesh.bin")


@router.get("/jobs/{job_id}/result/frames.bin")
def get_job_frames_binary(job_id: str):
    return _serve_binary(job_id, "frames.bin")


def _serve_binary(job_id: str, filename: str) -> FileResponse:
    try:
        path = job_dir(job_id) / filename
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"{filename} not found for this job.")
    return FileResponse(path, media_type="application/octet-stream")


def _launch_worker(directory: Path) -> None:
    backend_root = Path(__file__).resolve().parents[1]
    log_path = directory / "worker.log"
    log_handle = log_path.open("wb")
    try:
        subprocess.Popen(
            [sys.executable, "-m", "app.solver", str(directory)],
            cwd=str(backend_root),
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    finally:
        log_handle.close()


async def _save_upload(file: UploadFile, dest: Path) -> None:
    size = 0
    try:
        with dest.open("wb") as handle:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise ValueError("Uploaded DEM exceeds the 250 MB limit.")
                handle.write(chunk)
    except Exception:
        dest.unlink(missing_ok=True)
        raise
    finally:
        await file.close()
    if size == 0:
        dest.unlink(missing_ok=True)
        raise ValueError("The uploaded DEM file is empty.")


def _clean_name(name: str | None) -> str:
    raw = (name or "dem.tif").replace("\\", "/").split("/")[-1]
    cleaned = "".join(ch if ch.isalnum() or ch in "._- " else "_" for ch in raw).strip()
    return cleaned[:120] or "dem.tif"
