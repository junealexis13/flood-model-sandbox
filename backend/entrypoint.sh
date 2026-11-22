#!/bin/sh
set -eu

mkdir -p "$DATA_DIR"
if [ ! -f "$DATA_DIR/sample/hypsometric.json" ] || [ ! -f "$DATA_DIR/sample/hand_cog.tif" ]; then
  mkdir -p "$DATA_DIR/sample"
  cp -a /opt/sample-seed/. "$DATA_DIR/sample/"
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
