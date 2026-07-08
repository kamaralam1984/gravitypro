# Self-hosted OSRM routing engine

Powers road-snapped routes for the Live Family Map and Timeline/History Replay
(`backend/src/services/routing.js` is the only thing that talks to it). Fully
isolated from the PM2-managed app — its own Docker Compose project, its own
network, bound to `127.0.0.1` only. **Never exposed to the internet, never
added to Caddy, and the backend must never fall back to the public OSRM demo
server** (`router.project-osrm.org`) — that server explicitly prohibits
production use and `routing.js` refuses to start if `OSRM_BASE_URL` ever
points at it.

## Current coverage: Eastern Zone, not all of India yet

Starting scope is Geofabrik's India "Eastern Zone" (Bihar, Jharkhand, Odisha,
West Bengal — ~233MB), **not** the full India extract (~1.6GB). The full
India road network alone (124M nodes, 10.7M ways) consistently OOM-killed
`osrm-extract` at ~7GB RSS on this 7.8GB shared VPS — even with 8GB swap,
single-threaded, and non-routing data filtered out via osmium first, there
was no more fat to trim; the road graph itself was just too big for this box.

**To expand later** (bigger VPS, or preprocess on a separate/beefier machine
and copy only the finished `data/*.osrm*` files over): change `REGION` in
`scripts/prepare-extract.sh` and `scripts/swap-extract.sh`, update the
`VERIFY_COORDS`/healthcheck coordinates to somewhere inside the new region,
and update `docker-compose.osrm.yml`'s `command` filename to match — then
re-run `prepare-extract.sh`. No other code changes needed; `backend/src/services/routing.js`
and everything downstream is region-agnostic.

## First-time setup

Requires Docker + Docker Compose on the VPS (`docker --version` to confirm).

```bash
cd osrm
bash scripts/prepare-extract.sh      # downloads the Eastern Zone OSM extract (~233MB) +
                                      # preprocesses it (osrm-extract/partition/customize)
docker compose -f docker-compose.osrm.yml up -d
docker compose -f docker-compose.osrm.yml ps
docker inspect --format '{{.State.Health.Status}}' gravity-osrm   # expect "healthy" within ~45s
```

Then set `OSRM_BASE_URL=http://127.0.0.1:5050` in `/var/www/gravitypro/backend/.env`
(see `backend/.env.example`) and restart the backend: `pm2 restart gravity-api --update-env`.

## Startup / restart

```bash
cd osrm && docker compose -f docker-compose.osrm.yml up -d
```
`restart: unless-stopped` in the compose file means it also survives a VPS
reboot automatically once started — no separate systemd unit needed.

## Verify it's working

```bash
curl -s 'http://127.0.0.1:5050/route/v1/driving/85.1376,25.6093;85.1414,25.6127?overview=full&geometries=geojson' | jq '.code, .routes[0].distance'
# (Patna Junction -> Gandhi Maidan) — expect "Ok" and a plausible distance in meters
```

## Updating to a newer OSM extract

Map data changes over time; re-run periodically (monthly/quarterly is plenty
— OSRM's own preprocessing is the slow part, not how often OSM changes).

```bash
cd osrm
bash scripts/swap-extract.sh
```
This downloads + preprocesses into `data-new/`, verifies it actually serves a
route on a throwaway container before touching anything live, then swaps it
in and restarts the real service. If verification fails, the live service is
untouched. Old data lands in `data-old/` — delete it once you've confirmed
the new one is healthy: `rm -rf osrm/data-old`.

## Backup strategy: none needed

The processed `.osrm*` files in `osrm/data/` are 100% reproducible from the
pinned `ghcr.io/project-osrm/osrm-backend` image version + the source `.osm.pbf` (itself
re-downloadable from Geofabrik) + `scripts/prepare-extract.sh`. This data is
**deliberately excluded** from `scripts/backup-daily.sh` and the R2 offsite
backup — don't waste backup storage/time on disposable, easily-rebuilt data.
If OSRM is ever fully lost, just re-run `prepare-extract.sh`.

## Resource notes (shared VPS)

Measured on srv1569796: **7.8GB RAM (~4.3GB available), only 2 CPU cores
total**, shared with ~14 other PM2 apps for unrelated projects. `mem_limit: 2g`
/ `cpus: 1` in `docker-compose.osrm.yml` reflects that — leaves headroom for
everything else once OSRM is steady-state.

**The one-off `prepare-extract.sh`/`swap-extract.sh` preprocessing (`osrm-extract`
/ `osrm-partition` / `osrm-customize`) is NOT bound by that limit** (it runs as
separate `docker run` commands, not the compose service) and is genuinely
CPU-heavy — on a 2-core box this can peg both cores for a while and slow down
every other app on the VPS for the duration. Run it at a low-traffic time, and
expect it to take longer here than on a dedicated machine. If this becomes a
real problem, preprocess on a separate/beefier machine and copy only the
finished `data/*.osrm*` files over instead of running extract on the VPS itself.

**Swap is required regardless of region size.** The full-India extract's
`osrm-extract` OOM-killed three times on this VPS — first at ~4.7GB RSS
(zero swap configured at the time), then ~7GB RSS twice more even with 8GB
swap, `--threads 1`, and non-routing data (buildings, land use, POIs)
filtered out via `osmium tags-filter` first. India's road network alone
(124M nodes, 10.7M ways) was simply too large for a 7.8GB box — hence the
switch to Eastern Zone as the starting scope (see above). Keep the swapfile
and `--threads 1`/osmium-filter steps regardless — they're needed again the
moment `REGION` is widened, and cost nothing at the current smaller scope.
One-time setup (survives reboots via `/etc/fstab`):
```bash
fallocate -l 8G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -h   # confirm Swap: 8.0Gi
```

Disk: Eastern Zone's `.osm.pbf` is ~233MB, filtered + processed files well
under 1GB more — comfortably fits current free disk. Re-check `df -h /`
before widening `REGION`, since a full-India run needs several GB more.

## Algorithm choice: MLD, not CH

OSRM's current recommended default for country-sized graphs — lower steady-
state memory than the older Contraction Hierarchies (CH) algorithm, and its
`osrm-partition`/`osrm-customize` split (vs CH's full `osrm-contract` rebuild)
makes `swap-extract.sh`'s update flow simpler.
