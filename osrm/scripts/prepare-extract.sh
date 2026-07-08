#!/usr/bin/env bash
# One-off (and re-run-for-updates) preprocessing: download the India OSM
# extract, filter it down to routing-relevant data, and run it through OSRM's
# extract -> partition -> customize pipeline (MLD algorithm) to produce the
# .osrm* files docker-compose.osrm.yml serves. NOT part of the long-running
# service — run this manually, then
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
  echo "[1/5] India OSM extract already downloaded, skipping."
else
  echo "[1/5] Downloading India OSM extract..."
  curl -L --fail -o data/india-latest.osm.pbf "$EXTRACT_URL"
fi

# osrm-extract's memory use scales with the RAW .pbf's content, not just its
# file size — India's full extract (buildings, land use, POIs, etc.) OOM-
# killed at ~6.7GB RSS even single-threaded on this 7.8GB shared VPS. Filter
# down to routing-relevant data first (highway ways, ferry routes, turn
# restrictions, barrier nodes — osmium keeps their referenced nodes
# automatically) — this is the standard technique for large-country extracts
# on constrained hardware, and keeps full India coverage (no scope cut).
if [ -s data/india-filtered.osm.pbf ]; then
  echo "[2/5] Filtered extract already exists, skipping."
else
  echo "[2/5] Filtering to routing-relevant data (osmium tags-filter)..."
  command -v osmium >/dev/null || apt-get install -y osmium-tool
  osmium tags-filter data/india-latest.osm.pbf \
    w/highway w/route=ferry r/type=restriction n/barrier \
    -o data/india-filtered.osm.pbf
fi

# --threads 1: further caps peak memory during parsing. See osrm/README.md
# resource notes; this pairs with the swapfile mentioned there as a safety net.
echo "[3/5] osrm-extract (car profile)..."
docker run --rm -v "$HERE/data:/data" "$IMAGE" \
  osrm-extract --threads 1 -p /opt/car.lua /data/india-filtered.osm.pbf

echo "[4/5] osrm-partition..."
docker run --rm -v "$HERE/data:/data" "$IMAGE" \
  osrm-partition /data/india-filtered.osrm

echo "[5/5] osrm-customize..."
docker run --rm -v "$HERE/data:/data" "$IMAGE" \
  osrm-customize /data/india-filtered.osrm

echo "Done. Update docker-compose.osrm.yml's command to reference"
echo "india-filtered.osrm, then: docker compose -f docker-compose.osrm.yml up -d"
