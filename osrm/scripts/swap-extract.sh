#!/usr/bin/env bash
# Zero-downtime update: rebuild the OSRM data into data-new/, verify it serves
# a real route on a throwaway container + alternate port, then atomically swap
# it in for data/ and restart the live service. The old data becomes data-old/
# (delete manually once you've confirmed the new one is good).
#
# Usage: bash osrm/scripts/swap-extract.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

IMAGE="ghcr.io/project-osrm/osrm-backend:26.4.0"
EXTRACT_URL="https://download.geofabrik.de/asia/india-latest.osm.pbf"
STAGING="data-new"
VERIFY_PORT=5001

rm -rf "$STAGING"
mkdir -p "$STAGING"

echo "[1/5] Downloading fresh India OSM extract into $STAGING/..."
curl -L --fail -o "$STAGING/india-latest.osm.pbf" "$EXTRACT_URL"

echo "[2/5] osrm-extract / osrm-partition / osrm-customize..."
# --threads 1: see prepare-extract.sh — keeps peak memory in budget on a
# no-swap-by-default shared VPS.
docker run --rm -v "$HERE/$STAGING:/data" "$IMAGE" osrm-extract --threads 1 -p /opt/car.lua /data/india-latest.osm.pbf
docker run --rm -v "$HERE/$STAGING:/data" "$IMAGE" osrm-partition /data/india-latest.osrm
docker run --rm -v "$HERE/$STAGING:/data" "$IMAGE" osrm-customize /data/india-latest.osrm

echo "[3/5] Verifying the new data on a throwaway container (port $VERIFY_PORT)..."
docker run -d --rm --name gravity-osrm-verify \
  -v "$HERE/$STAGING:/data:ro" -p "127.0.0.1:$VERIFY_PORT:5000" "$IMAGE" \
  osrm-routed --algorithm mld /data/india-latest.osrm
sleep 5
RESULT=$(curl -sf "http://127.0.0.1:$VERIFY_PORT/route/v1/driving/77.2295,28.6129;77.2167,28.6315?overview=false" || echo "FAILED")
docker stop gravity-osrm-verify >/dev/null 2>&1 || true

if [[ "$RESULT" != *'"Ok"'* ]]; then
  echo "Verification FAILED — new extract not swapped in. Old data/ is untouched."
  echo "Response was: $RESULT"
  exit 1
fi
echo "Verification OK."

echo "[4/5] Swapping data/ -> data-old/, $STAGING/ -> data/..."
rm -rf data-old
[ -d data ] && mv data data-old
mv "$STAGING" data

echo "[5/5] Restarting the live OSRM service..."
docker compose -f docker-compose.osrm.yml up -d --force-recreate

echo "Done. Old data kept at osrm/data-old/ — delete it once you've confirmed the live service is healthy:"
echo "  docker inspect --format '{{.State.Health.Status}}' gravity-osrm"
echo "  rm -rf osrm/data-old"
