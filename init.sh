#!/usr/bin/env bash
# Unified launcher for all 3 Flood Model Sandbox services:
#   1. HAND API            (backend/, .venv)                -> port 8000 (local) / 8010 (Docker)
#   2. ANUGA Flow Sim API  (flow_sim_backend/, conda env)   -> port 8001 (local) / 8011 (Docker)
#   3. Web UI              (frontend/, Node/Vite or Nginx)  -> port 5173 (local) / 8080 (Docker)
#
# Usage:
#   ./init.sh                 Start all 3 services locally (default)
#   ./init.sh local           Start all 3 services locally
#   ./init.sh docker [args]   Build & start all 3 services via Docker Compose (e.g. ./init.sh docker -d)
#   ./init.sh down [args]     Stop Docker Compose stack (e.g. ./init.sh down -v)
#   ./init.sh --help          Show this help message
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

HOST="${HOST:-127.0.0.1}"
HAND_PORT="${HAND_PORT:-8000}"
FLOW_SIM_PORT="${FLOW_SIM_PORT:-8001}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
FLOW_SIM_CONDA_ENV="${FLOW_SIM_CONDA_ENV:-anuga-flow-sim}"

usage() {
  cat <<'EOF'
Usage: ./init.sh [mode] [extra args]

Modes:
  local (default)   Start all 3 services locally in isolated environments:
                      - HAND API           (.venv)                http://127.0.0.1:8000
                      - ANUGA Flow Sim API (conda anuga-flow-sim) http://127.0.0.1:8001
                      - Frontend UI        (Vite / npm)           http://localhost:5173
  docker [args...]  Build and deploy all 3 services via Docker Compose (http://localhost:8080).
                    Example: ./init.sh docker -d
  down [args...]    Stop Docker Compose containers (example: ./init.sh down -v).
  -h, --help        Show this help text.

Optional environment overrides (local mode):
  HAND_PYTHON         Path to Python executable for backend/
  FLOW_SIM_PYTHON     Path to Python executable for flow_sim_backend/
  FLOW_SIM_CONDA_ENV  Conda environment name (default: anuga-flow-sim)
  HAND_PORT           HAND API port (default: 8000)
  FLOW_SIM_PORT       Flow Sim API port (default: 8001)
  FRONTEND_PORT       Vite dev server port (default: 5173)
EOF
}

MODE="${1:-local}"
case "$MODE" in
  -h|--help|help)
    usage
    exit 0
    ;;
  docker|--docker)
    shift || true
    if ! command -v docker >/dev/null 2>&1; then
      echo "Error: 'docker' not found on PATH." >&2
      exit 1
    fi
    echo "Deploying all 3 services with Docker Compose..."
    echo "  Web UI:       http://localhost:8080"
    echo "  HAND API:     http://127.0.0.1:8010/api/health"
    echo "  Flow Sim API: http://127.0.0.1:8011/api/flow-sim/health"
    cd "$ROOT"
    exec docker compose up --build "$@"
    ;;
  down|docker-down|--down)
    shift || true
    cd "$ROOT"
    exec docker compose down "$@"
    ;;
  local|--local)
    shift || true
    ;;
  *)
    echo "Unknown mode: $MODE" >&2
    usage >&2
    exit 1
    ;;
esac

# --- 1. Resolve HAND API Python (.venv) ---------------------------------------
resolve_hand_python() {
  if [[ -n "${HAND_PYTHON:-}" && -x "$HAND_PYTHON" ]]; then
    echo "$HAND_PYTHON"
    return 0
  fi
  if [[ -x "$ROOT/.venv/bin/python" ]]; then
    echo "$ROOT/.venv/bin/python"
    return 0
  fi
  if [[ -x "$ROOT/backend/.venv/bin/python" ]]; then
    echo "$ROOT/backend/.venv/bin/python"
    return 0
  fi
  echo "Error: HAND API virtualenv not found." >&2
  echo "Create it from the repository root:" >&2
  echo "  python3 -m venv .venv && .venv/bin/python -m pip install -r backend/requirements.txt" >&2
  return 1
}

# --- 2. Resolve ANUGA Flow Sim Conda Python (anuga-flow-sim) ------------------
resolve_flow_sim_python() {
  if [[ -n "${FLOW_SIM_PYTHON:-}" && -x "$FLOW_SIM_PYTHON" ]]; then
    echo "$FLOW_SIM_PYTHON"
    return 0
  fi

  local candidates=()
  if [[ -n "${CONDA_PREFIX:-}" && "$(basename "$CONDA_PREFIX")" == "$FLOW_SIM_CONDA_ENV" ]]; then
    candidates+=("$CONDA_PREFIX")
  fi

  local base
  for tool in mamba micromamba conda; do
    if command -v "$tool" >/dev/null 2>&1; then
      base="$("$tool" info --base 2>/dev/null || true)"
      if [[ -n "$base" ]]; then
        candidates+=("$base/envs/$FLOW_SIM_CONDA_ENV")
      fi
    fi
  done

  candidates+=(
    "$HOME/miniconda3/envs/$FLOW_SIM_CONDA_ENV"
    "$HOME/miniforge3/envs/$FLOW_SIM_CONDA_ENV"
    "$HOME/mambaforge/envs/$FLOW_SIM_CONDA_ENV"
    "$HOME/anaconda3/envs/$FLOW_SIM_CONDA_ENV"
    "/opt/conda/envs/$FLOW_SIM_CONDA_ENV"
  )

  local env_dir
  for env_dir in "${candidates[@]}"; do
    if [[ -x "$env_dir/bin/python" ]]; then
      echo "$env_dir/bin/python"
      return 0
    fi
  done

  echo "Error: Conda environment '$FLOW_SIM_CONDA_ENV' not found." >&2
  echo "Create it from the repository root:" >&2
  echo "  conda env create -f flow_sim_backend/environment.yml" >&2
  return 1
}

# --- 3. Resolve Frontend tooling (npm + node_modules) -------------------------
check_frontend() {
  if ! command -v npm >/dev/null 2>&1; then
    echo "Error: 'npm' not found on PATH. Install Node.js 18+ to run the frontend." >&2
    return 1
  fi
  if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
    echo "Installing frontend dependencies (frontend/node_modules not found)..."
    (cd "$ROOT/frontend" && npm install)
  fi
}

# --- Port pre-flight check ----------------------------------------------------
check_port_free() {
  local port="$1"
  local label="$2"
  if "$HAND_PYTHON" -c "
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(0.3)
in_use = s.connect_ex(('127.0.0.1', int(sys.argv[1]))) == 0
s.close()
sys.exit(0 if in_use else 1)
" "$port"; then
    echo "Error: Port $port ($label) is already in use." >&2
    echo "Stop the existing process on port $port before running ./init.sh." >&2
    return 1
  fi
}

# Strip a directory from a colon-delimited PATH string.
strip_from_path() {
  local dir_to_remove="$1"
  local path_val="$2"
  local result=""
  local part
  IFS=':' read -ra parts <<< "$path_val"
  for part in "${parts[@]}"; do
    if [[ -n "$part" && "$part" != "$dir_to_remove" ]]; then
      result="${result:+$result:}$part"
    fi
  done
  echo "$result"
}

HAND_PYTHON="$(resolve_hand_python)"
HAND_VENV_DIR="$(cd "$(dirname "$HAND_PYTHON")/.." && pwd)"

FLOW_SIM_PYTHON="$(resolve_flow_sim_python)"
FLOW_SIM_ENV_DIR="$(cd "$(dirname "$FLOW_SIM_PYTHON")/.." && pwd)"

check_frontend

check_port_free "$HAND_PORT" "HAND API"
check_port_free "$FLOW_SIM_PORT" "ANUGA Flow Sim API"
check_port_free "$FRONTEND_PORT" "Frontend UI"

# Build a clean base PATH without any active .venv or conda env bin directories.
BASE_PATH="$PATH"
BASE_PATH="$(strip_from_path "$ROOT/.venv/bin" "$BASE_PATH")"
BASE_PATH="$(strip_from_path "$ROOT/backend/.venv/bin" "$BASE_PATH")"
BASE_PATH="$(strip_from_path "$HAND_VENV_DIR/bin" "$BASE_PATH")"
BASE_PATH="$(strip_from_path "$FLOW_SIM_ENV_DIR/bin" "$BASE_PATH")"
if [[ -n "${VIRTUAL_ENV:-}" ]]; then
  BASE_PATH="$(strip_from_path "$VIRTUAL_ENV/bin" "$BASE_PATH")"
fi

PIDS=()
NAMES=()
CLEANED_UP=0

cleanup() {
  if [[ "$CLEANED_UP" -eq 1 ]]; then
    return
  fi
  CLEANED_UP=1
  echo ""
  echo "Stopping all services..."
  local pid
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  sleep 0.5
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    fi
  done
  wait "${PIDS[@]}" 2>/dev/null || true
  echo "All services stopped."
}

on_signal() {
  cleanup
  exit 0
}

trap on_signal INT TERM
trap cleanup EXIT

start_service() {
  local name="$1"
  local cmd="$2"
  if command -v setsid >/dev/null 2>&1; then
    setsid bash -euo pipefail -c "$cmd" > >(sed -u "s/^/[$name] /") 2>&1 &
  else
    bash -euo pipefail -c "$cmd" > >(sed -u "s/^/[$name] /") 2>&1 &
  fi
  PIDS+=("$!")
  NAMES+=("$name")
}

echo "Starting Flood Model Sandbox (3 local services)..."
echo "  1. HAND API            -> http://${HOST}:${HAND_PORT}   (${HAND_PYTHON})"
echo "  2. ANUGA Flow Sim API  -> http://${HOST}:${FLOW_SIM_PORT}   (${FLOW_SIM_PYTHON})"
echo "  3. Frontend UI         -> http://localhost:${FRONTEND_PORT} (HAND & 3D Flow Sim)"
echo "Press Ctrl+C to stop all services."
echo ""

# Service 1: HAND API (isolated to .venv)
HAND_CMD=$(cat <<EOF
unset CONDA_PREFIX CONDA_DEFAULT_ENV CONDA_PROMPT_MODIFIER CONDA_SHLVL
export VIRTUAL_ENV=$(printf '%q' "$HAND_VENV_DIR")
export PATH=$(printf '%q' "$HAND_VENV_DIR/bin:$BASE_PATH")
export PYTHONUNBUFFERED=1
cd $(printf '%q' "$ROOT/backend")
exec $(printf '%q' "$HAND_PYTHON") -m uvicorn app.main:app --reload --host $(printf '%q' "$HOST") --port $(printf '%q' "$HAND_PORT")
EOF
)

# Service 2: ANUGA Flow Sim API (isolated to conda env + activate.d for GDAL/PROJ)
FLOW_SIM_CMD=$(cat <<EOF
unset VIRTUAL_ENV
export CONDA_PREFIX=$(printf '%q' "$FLOW_SIM_ENV_DIR")
export CONDA_DEFAULT_ENV=$(printf '%q' "$FLOW_SIM_CONDA_ENV")
export PATH=$(printf '%q' "$FLOW_SIM_ENV_DIR/bin:$BASE_PATH")
export OMP_NUM_THREADS=$(printf '%q' "${OMP_NUM_THREADS:-1}")
export PYTHONUNBUFFERED=1
if [[ -d $(printf '%q' "$FLOW_SIM_ENV_DIR/etc/conda/activate.d") ]]; then
  set +u
  for f in $(printf '%q' "$FLOW_SIM_ENV_DIR/etc/conda/activate.d")/*.sh; do
    [[ -r "\$f" ]] && source "\$f"
  done
  set -u
fi
cd $(printf '%q' "$ROOT/flow_sim_backend")
exec $(printf '%q' "$FLOW_SIM_PYTHON") -m uvicorn app.main:app --reload --host $(printf '%q' "$HOST") --port $(printf '%q' "$FLOW_SIM_PORT")
EOF
)

# Service 3: Frontend Vite dev server
FRONTEND_CMD=$(cat <<EOF
export PATH=$(printf '%q' "$BASE_PATH")
cd $(printf '%q' "$ROOT/frontend")
exec npm run dev -- --port $(printf '%q' "$FRONTEND_PORT")
EOF
)

start_service "hand-api" "$HAND_CMD"
start_service "flow-sim" "$FLOW_SIM_CMD"
start_service "frontend" "$FRONTEND_CMD"

# Monitor all 3 services; exit cleanly if any service terminates unexpectedly.
EXIT_CODE=0
while true; do
  for i in "${!PIDS[@]}"; do
    pid="${PIDS[$i]}"
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid" || EXIT_CODE=$?
      echo "Service '${NAMES[$i]}' exited (code $EXIT_CODE). Shutting down remaining services..." >&2
      exit "$EXIT_CODE"
    fi
  done
  sleep 1
done
