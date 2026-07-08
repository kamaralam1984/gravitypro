#!/usr/bin/env bash
# One-off (and re-run-for-updates) preprocessing: download the India OSM
# extract and run it through OSRM's extract -> partition -> customize
# pipeline (MLD algorithm) to produce the .osrm* files docker-compose.osrm.yml
# serves. NOT part of the long-running service — run this manually, then
# `docker compose -f docker-compose.osrm.yml up -d` (or restart if already up).
#
# Usage: bash osrm/scripts/prepare-extract.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

IMAGE="ghcr.io/project-osrm/osrm-backend:26.4.0"
EXTRACT_URL="https://download.geofabrik.de/asia/india-latest.osm.pbf"

mkdir -p data
if [ -s data/india-latest.osm.pbf ]; then
  echo "[1/4] India OSM extract already downloaded, skipping."
else
  echo "[1/4] Downloading India OSM extract..."
  curl -L --fail -o data/india-latest.osm.pbf "$EXTRACT_URL"
fi

# --threads 1: a country-sized extract's peak memory scales with parallelism
# (each thread holds its own parse buffers) — this VPS has no swap configured,
# so a 2-thread extract OOM-killed at ~4.7GB RSS on a shared 7.8GB box. Single-
# threaded is slower but keeps the peak well within budget. See osrm/README.md
# resource notes; this pairs with the swapfile mentioned there as a safety net.
echo "[2/4] osrm-extract (car profile)..."
docker run --rm -v "$HERE/data:/data" "$IMAGE" \
  osrm-extract --threads 1 -p /opt/car.lua /data/india-latest.osm.pbf

echo "[3/4] osrm-partition..."
docker run --rm -v "$HERE/data:/data" "$IMAGE" \
  osrm-partition /data/india-latest.osrm

echo "[4/4] osrm-customize..."
docker run --rm -v "$HERE/data:/data" "$IMAGE" \
  osrm-customize /data/india-latest.osrm

echo "Done. Start/restart the OSRM service:"
echo "  docker compose -f docker-compose.osrm.yml up -d"
