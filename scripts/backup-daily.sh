#!/usr/bin/env bash
# backup-daily.sh — full daily backup of the GravityPro database + application
# code, so a deleted/corrupted table, dropped column, or wiped code directory
# can be restored from a known-good point in time.
#
# Produces one restore point per calendar day under /var/backups/gravitypro/<date>/:
#   - database.sql.gz  (pg_dump --clean --if-exists, safe to replay onto a live DB)
#   - code.tar.gz       (full /var/www/gravitypro source, minus reinstallable/build junk)
# Also uploads both to the R2 bucket already used for asset storage (backups/<date>/
# prefix), so a lost VPS disk doesn't take the backups down with it.
#
# Usage: bash scripts/backup-daily.sh   (run manually, or via cron — see
# scripts/RESTORE.md for the cron setup + how to restore from a backup.)
set -euo pipefail

APP_DIR="/var/www/gravitypro"
BACKUP_ROOT="/var/backups/gravitypro"
RETENTION_DAYS=14
STAMP="$(date +%Y-%m-%d)"
DAY_DIR="$BACKUP_ROOT/$STAMP"
LOG_FILE="/var/log/gravitypro-backup.log"

mkdir -p "$DAY_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "===== GravityPro backup started: $(date '+%Y-%m-%d %H:%M:%S') ====="

# Load DATABASE_URL / R2 creds from the production .env (gitignored, VPS-only).
# Deliberately NOT `source`d — values like SMTP_FROM contain unescaped `<`/`>`
# (display-name email format) that bash misparses as redirection when sourced.
env_get() { grep -E "^$1=" "$APP_DIR/backend/.env" | head -1 | cut -d= -f2-; }
DATABASE_URL="$(env_get DATABASE_URL)"
R2_ACCOUNT_ID="$(env_get R2_ACCOUNT_ID)"
R2_ACCESS_KEY_ID="$(env_get R2_ACCESS_KEY_ID)"
R2_SECRET_ACCESS_KEY="$(env_get R2_SECRET_ACCESS_KEY)"
R2_BUCKET_NAME="$(env_get R2_BUCKET_NAME)"

echo "[1/3] Dumping database..."
# Neon runs a newer Postgres major version than Ubuntu 22.04's default apt
# client — pg_dump refuses to talk to a server newer than itself, so pick the
# highest-versioned client actually installed (see RESTORE.md for the PGDG
# repo setup that installs postgresql-client-18 alongside the default 14).
PG_DUMP_BIN="$(ls /usr/lib/postgresql/*/bin/pg_dump 2>/dev/null | sort -V | tail -1)"
PG_DUMP_BIN="${PG_DUMP_BIN:-pg_dump}"
"$PG_DUMP_BIN" --clean --if-exists "$DATABASE_URL" | gzip > "$DAY_DIR/database.sql.gz"
echo "  -> $(du -h "$DAY_DIR/database.sql.gz" | cut -f1)"

echo "[2/3] Archiving code..."
tar --exclude='node_modules' \
    --exclude='landing-react/.next' \
    --exclude='landing-react/dist' \
    --exclude='mobile/node_modules' \
    -czf "$DAY_DIR/code.tar.gz" -C "$APP_DIR" .
echo "  -> $(du -h "$DAY_DIR/code.tar.gz" | cut -f1)"

# Offsite upload is a nice-to-have, not the primary backup — a placeholder or
# misconfigured R2 credential must never abort the local backup + pruning below.
if [ -n "${R2_ACCOUNT_ID:-}" ] && [ "$R2_ACCOUNT_ID" != "your-cloudflare-account-id" ] && [ -n "${R2_ACCESS_KEY_ID:-}" ]; then
  echo "[3/3] Uploading offsite copy to R2..."
  for f in database.sql.gz code.tar.gz; do
    AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
      aws s3 cp "$DAY_DIR/$f" "s3://$R2_BUCKET_NAME/backups/$STAMP/$f" \
      --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" --only-show-errors \
      || echo "  WARNING: R2 upload of $f failed — local backup is still intact, continuing."
  done
else
  echo "[3/3] Skipped offsite upload — R2 credentials not set in backend/.env (local backup only)"
fi

echo "Pruning local backups older than $RETENTION_DAYS days..."
find "$BACKUP_ROOT" -maxdepth 1 -mindepth 1 -type d -mtime "+$RETENTION_DAYS" -exec rm -rf {} \;

echo "===== Backup finished: $(date '+%Y-%m-%d %H:%M:%S') ====="
