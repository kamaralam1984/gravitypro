# Self-hosted OSRM routing engine

Powers road-snapped routes for the Live Family Map and Timeline/History Replay
(`backend/src/services/routing.js` is the only thing that talks to it). Fully
isolated from the PM2-managed app — its own Docker Compose project, its own
network, bound to `127.0.0.1` only. **Never exposed to the internet, never
added to Caddy, and the backend must never fall back to the public OSRM demo
server** (`router.project-osrm.org`) — that server explicitly prohibits
production use and `routing.js` refuses to start if `OSRM_BASE_URL` ever
points at it.

## First-time setup

Requires Docker + Docker Compose on the VPS (`docker --version` to confirm).

```bash
cd osrm
bash scripts/prepare-extract.sh      # downloads India OSM extract (~1GB) +
                                      # preprocesses it (osrm-extract/partition/customize)
docker compose -f docker-compose.osrm.yml up -d
docker compose -f docker-compose.osrm.yml ps
docker inspect --format '{{.State.Health.Status}}' gravity-osrm   # expect "healthy" within ~45s
```

Then set `OSRM_BASE_URL=http://127.0.0.1:5000` in `/var/www/gravitypro/backend/.env`
(see `backend/.env.example`) and restart the backend: `pm2 restart gravity-api --update-env`.

## Startup / restart

```bash
cd osrm && docker compose -f docker-compose.osrm.yml up -d
```
`restart: unless-stopped` in the compose file means it also survives a VPS
reboot automatically once started — no separate systemd unit needed.

## Verify it's working

```bash
curl -s 'http://127.0.0.1:5000/route/v1/driving/77.2295,28.6129;77.2167,28.6315?overview=full&geometries=geojson' | jq '.code, .routes[0].distance'
# expect "Ok" and a plausible distance in meters
```

## Updating to a newer OSM extract

India's map data changes over time; re-run periodically (monthly/quarterly is
plenty — OSRM's own preprocessing is the slow part, not how often OSM changes).

```bash
cd osrm
bash scripts/swap-extract.sh
```
This downloads + preprocesses into `data-new/`, verifies it actually serves a
route on a throwaway container before touching anything live, then swaps it
in and restarts the real service. If verification fails, the live service is
untouched. Old data lands in `data-old/` — delete it once you've confirmed
the new one is healthy: `rm -rf osrm/data-old`.

To expand beyond India later (other Geofabrik regions, or a combined extract),
edit `EXTRACT_URL` in both scripts and the `osrm-routed` command's filename in
`docker-compose.osrm.yml` to match.

## Backup strategy: none needed

The processed `.osrm*` files in `osrm/data/` are 100% reproducible from the
pinned `osrm/osrm-backend` image version + the source `.osm.pbf` (itself
re-downloadable from Geofabrik) + `scripts/prepare-extract.sh`. This data is
**deliberately excluded** from `scripts/backup-daily.sh` and the R2 offsite
backup — don't waste backup storage/time on disposable, easily-rebuilt data.
If OSRM is ever fully lost, just re-run `prepare-extract.sh`.

## Resource notes (shared VPS)

This VPS runs ~14 other PM2 apps for unrelated projects. `docker-compose.osrm.yml`
sets `mem_limit: 3g` / `cpus: 1.5` as a starting point — check `free -h` on the
VPS and adjust if it's too tight or unnecessarily generous. The one-off
`prepare-extract.sh`/`swap-extract.sh` preprocessing steps use more RAM
transiently than the steady-state serving container does; if the VPS is RAM-
constrained, consider running preprocessing on a separate machine and copying
only the finished `data/*.osrm*` files over instead.

Disk: the `.osm.pbf` is ~800MB-1GB, processed files ~2-4GB more — budget ~5GB
free before running `prepare-extract.sh`.

## Algorithm choice: MLD, not CH

OSRM's current recommended default for country-sized graphs — lower steady-
state memory than the older Contraction Hierarchies (CH) algorithm, and its
`osrm-partition`/`osrm-customize` split (vs CH's full `osrm-contract` rebuild)
makes `swap-extract.sh`'s update flow simpler.
