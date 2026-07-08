# GravityPro backup & restore

`scripts/backup-daily.sh` runs once every day via cron on the VPS and writes one
restore point per calendar day to `/var/backups/gravitypro/<YYYY-MM-DD>/`:

- `database.sql.gz` — full Postgres dump (`pg_dump --clean --if-exists`), safe to
  replay directly onto the live database (it drops/recreates objects first).
- `code.tar.gz` — full snapshot of `/var/www/gravitypro` (source + `.env` files),
  minus `node_modules` and build caches.

A copy of both files is also uploaded to the R2 bucket (`backups/<date>/` prefix)
so a lost VPS disk doesn't take the backups down with it. Local backups older
than 14 days are pruned automatically; R2 keeps everything unless deleted by hand.

## One-time setup: newer `pg_dump`

Neon (the production DB host) runs a Postgres major version newer than Ubuntu
22.04's default `apt` package (14). `pg_dump` refuses to dump from a server
newer than itself, so install the PGDG repo's newer client alongside it —
`backup-daily.sh` auto-picks the highest-versioned `pg_dump` it finds under
`/usr/lib/postgresql/*/bin/`:

```bash
apt install -y curl ca-certificates
install -d /usr/share/postgresql-common/pgdg
curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc
sh -c 'echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list'
apt update
apt install -y postgresql-client-18
```

## List available restore points

```bash
ls /var/backups/gravitypro/
```

## Restore the database

**This overwrites the live database with the dump's contents — confirm the date
is right before running.**

```bash
DATE=2026-07-08   # pick the restore point
DATABASE_URL="$(grep -E '^DATABASE_URL=' /var/www/gravitypro/backend/.env | head -1 | cut -d= -f2-)"
PSQL_BIN="$(ls /usr/lib/postgresql/*/bin/psql 2>/dev/null | sort -V | tail -1)"
PSQL_BIN="${PSQL_BIN:-psql}"
gunzip -c /var/backups/gravitypro/$DATE/database.sql.gz | "$PSQL_BIN" "$DATABASE_URL"
```

**Don't `source /var/www/gravitypro/backend/.env` directly** — `SMTP_FROM`
contains unescaped `<`/`>` (email display-name format) that bash misparses as
redirection when sourced. Always pull `DATABASE_URL` via `grep`/`cut` as above.

## Restore code

Don't extract straight over the live app directory — extract to a scratch
folder first, then copy back only what's actually needed:

```bash
DATE=2026-07-08
mkdir -p /tmp/restore-$DATE
tar -xzf /var/backups/gravitypro/$DATE/code.tar.gz -C /tmp/restore-$DATE
# review / diff against /var/www/gravitypro, then copy back what's needed, e.g.:
cp -r /tmp/restore-$DATE/backend/src /var/www/gravitypro/backend/src
pm2 restart gravity-api
```

## Restore from the offsite (R2) copy

If the VPS disk itself is gone, pull from R2 instead (needs `aws` CLI + R2
credentials — same ones from `backend/.env`):

```bash
aws s3 cp s3://gravity-assets/backups/2026-07-08/database.sql.gz . \
  --endpoint-url https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
aws s3 cp s3://gravity-assets/backups/2026-07-08/code.tar.gz . \
  --endpoint-url https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
```

## Cron setup (one-time)

```bash
crontab -e
```
Add:
```
15 1 * * * /usr/bin/bash /var/www/gravitypro/scripts/backup-daily.sh >> /var/log/gravitypro-backup.log 2>&1
```
Runs daily at 1:15 AM server time (after the app's own 2 AM/3 AM cleanup jobs
elsewhere in the day, no overlap).
