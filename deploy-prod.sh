#!/bin/bash
# Gravity Production Deploy
# Run once when switching to gravity.trackalways.com domain
# Usage: bash deploy-prod.sh

set -e
GRAVITY_DIR="/media/server/linux-part/Gravity"
CADDY_BIN="$GRAVITY_DIR/caddy/caddy-bin"

echo "[1] Running database migrations..."
cd "$GRAVITY_DIR/backend" && node src/db/migrate.js

echo "[2] Restarting PM2 services..."
pm2 restart gravity-api gravity-web

echo "[3] Switching Caddy to production config (gravity.trackalways.com + TLS)..."
$CADDY_BIN stop 2>/dev/null || true
sleep 1
mkdir -p /tmp/caddy-data
$CADDY_BIN run \
  --config "$GRAVITY_DIR/caddy/Caddyfile.prod" \
  --adapter caddyfile \
  --environ \
  > /tmp/gravity-caddy.log 2>&1 &

echo "[4] Waiting for Caddy to start..."
sleep 3

echo "[5] Health check..."
curl -sf http://localhost:8002/health && echo " API OK"

echo ""
echo "Deploy complete!"
echo "  API:     https://gravity.trackalways.com/api/v1/"
echo "  Web:     https://gravity.trackalways.com/"
echo "  PM2:     pm2 list"
echo "  Logs:    pm2 logs gravity-api"
