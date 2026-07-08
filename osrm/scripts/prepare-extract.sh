#!/usr/bin/env bash
# One-off (and re-run-for-updates) preprocessing: download the OSM extract
# for REGION, filter it down to routing-relevant data, and run it through
# OSRM's extract -> partition -> customize pipeline (MLD algorithm) to
# produce the .osrm* files docker-compose.osrm.yml serves. NOT part of the
# long-running service — run this manually, then
# `docker compose -f docker-compose.osrm.yml up -d` (or restart if already up).
#
# Usage: bash osrm/scripts/prepare-extract.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

IMAGE="ghcr.io/project-osrm/osrm-backend:26.4.0"

# REGION: starting scope is Geofabrik's India "Eastern Zone" (Bihar,
# Jharkhand, Odisha, West Bengal — ~233MB), not the full India extract
# (~1.6GB). The full-India extract's road network alone (124M nodes, 10.7M
# ways) consistently OOM-killed osrm-extract at ~7GB RSS on this 7.8GB shared
# VPS even with 8GB swap + single-threaded + non-routing-data filtered out —
# there was no more fat to trim, the road graph itself was just too big for
# this box. To expand later (bigger VPS, or preprocess elsewhere and copy the
# finished .osrm* files over — see README.md), change REGION/EXTRACT_URL here
# and in swap-extract.sh + docker-compose.osrm.yml's data filename, then
# re-run this script.
REGION="eastern-zone"
EXTRACT_URL="https://download.geofabrik.de/asia/india/${REGION}-latest.osm.pbf"

mkdir -p data
if [ -s "data/${REGION}-latest.osm.pbf" ]; then
  echo "[1/5] ${REGION} OSM extract already downloaded, skipping."
else
  echo "[1/5] Downloading ${REGION} OSM extract..."
  curl -L --fail -o "data/${REGION}-latest.osm.pbf" "$EXTRACT_URL"
fi

# Filtering to routing-relevant data (highway ways, ferry routes, turn
# restrictions, barrier nodes — osmium keeps their referenced nodes
# automatically) is cheap and still worth doing at this smaller scope, same
# technique as would be needed again if REGION is later widened.
if [ -s "data/${REGION}-filtered.osm.pbf" ]; then
  echo "[2/5] Filtered extract already exists, skipping."
else
  echo "[2/5] Filtering to routing-relevant data (osmium tags-filter)..."
  command -v osmium >/dev/null || apt-get install -y osmium-tool
  osmium tags-filter "data/${REGION}-latest.osm.pbf" \
    w/highway w/route=ferry r/type=restriction n/barrier \
    -o "data/${REGION}-filtered.osm.pbf"
fi

# --threads 1: caps peak memory during parsing. See osrm/README.md resource
# notes; this pairs with the swapfile mentioned there as a safety net.
echo "[3/5] osrm-extract (car profile)..."
docker run --rm -v "$HERE/data:/data" "$IMAGE" \
  osrm-extract --threads 1 -p /opt/car.lua "/data/${REGION}-filtered.osm.pbf"

echo "[4/5] osrm-partition..."
docker run --rm -v "$HERE/data:/data" "$IMAGE" \
  osrm-partition "/data/${REGION}-filtered.osrm"

echo "[5/5] osrm-customize..."
docker run --rm -v "$HERE/data:/data" "$IMAGE" \
  osrm-customize "/data/${REGION}-filtered.osrm"

echo "Done. Confirm docker-compose.osrm.yml's command references"
echo "${REGION}-filtered.osrm, then: docker compose -f docker-compose.osrm.yml up -d"
