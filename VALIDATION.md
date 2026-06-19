# Trackalways Gravity — Infrastructure Validation Report

**Validation Date:** 2026-06-18
**Validator:** Document Validator (Claude Sonnet 4.6)
**Scope:** /media/server/linux-part/Gravity/ vs Infrastructure Design Document

---

## SUMMARY

| Category | Status |
|---|---|
| Tech Stack | PARTIAL — node-cron present but BullMQ MISSING |
| Core Features | PARTIAL — background location, Traccar, PostGIS, geofencing, R2, SSE all present; SLC APIs MISSING |
| Data Flows | PRESENT |
| Country Support | PRESENT |
| Excluded Features | CLEAN — none found |

Overall: **8 of 9 tech stack items implemented, 5 of 6 core features implemented.**

---

## TECH STACK — PRESENT

### 1. Caddy Server
- **File:** `caddy/Caddyfile`
- Automatic TLS via `gravity.trackalways.com { ... }` (Caddy's default behaviour)
- SSE buffering explicitly disabled: `flush_interval -1` on the `@sse path /api/v1/sse/*` matcher
- Traccar telemetry proxied to `localhost:8082`
- Express backend proxied to `localhost:3000`
- Security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`) present
- Gzip encoding enabled

### 2. Expo 54 + React Native 0.81
- **File:** `mobile/package.json`
- `"expo": "~54.0.0"` — matches spec exactly
- `"react-native": "0.81.0"` — matches spec exactly
- Expo Router, expo-location, expo-task-manager, expo-notifications all present

### 3. Traccar Middleware (telemetry ingestion)
- **Files:** `mobile/src/services/location.js`, `caddy/Caddyfile`, `backend/src/webhooks/traccar.js`
- Mobile sends HTTP GET to `https://gravity.trackalways.com/telemetry/?id=...&lat=...&lon=...` via `expo-task-manager` background task
- Caddy proxies `/telemetry/*` to `localhost:8082` (Traccar port)
- Traccar webhook handler at `POST /webhooks/traccar/location` receives processed location events from Traccar and writes to PostGIS

### 4. Node.js v20+ + Express 5.2.x
- **File:** `backend/package.json`
- `"engines": { "node": ">=20.0.0" }` — meets Node.js v20+ requirement
- `"express": "^5.2.0"` — matches Express 5.2.x spec exactly

### 5. PostgreSQL (Neon Cloud) + PostGIS
- **Files:** `backend/src/config/db.js`, `backend/migrations/001_initial.sql`, `backend/.env.example`
- `pg` pool connects via `DATABASE_URL` (example shows Neon Cloud connection string)
- `CREATE EXTENSION IF NOT EXISTS postgis` in migration
- PostGIS geometry columns on `device_locations`, `user_latest_locations`, `safe_zones`, `geofence_events`
- GIST spatial indexes on all geometry columns

### 6. Cloudflare R2
- **Files:** `backend/src/config/r2.js`, `backend/src/routes/media.js`
- S3-compatible client pointed at `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
- Pre-signed PUT URL generation via `@aws-sdk/s3-request-presigner`
- Confirmed URL stored in PostgreSQL (`UPDATE users SET avatar_url`, `UPDATE circles SET icon_url`)

### 7. SSE — Server-Sent Events
- **Files:** `backend/src/routes/sse.js`, `backend/src/services/sse.js`, `mobile/src/screens/HomeScreen.jsx`
- Backend: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`, keep-alive ping every 25 s
- In-memory `Map<userId, Set<res>>` client registry with multi-connection support
- Mobile: `EventSource` connecting to `/api/v1/sse/stream` with `Authorization` header
- Real-time `location_update` events dispatched on each Traccar webhook call
- No WebSockets found anywhere in the codebase

### 8. node-cron (background jobs)
- **File:** `backend/src/jobs/index.js`
- Two cron jobs registered at startup via `node-cron`:
  - `0 2 * * *` — purge location history older than 7 days
  - `0 3 * * *` — purge geofence events older than 30 days

---

## TECH STACK — MISSING

### BullMQ
- **Status: MISSING**
- The design document specifies the job queue progression `node-cron → BullMQ`. Only `node-cron` is implemented.
- `bullmq` does not appear in `backend/package.json` or any source file.
- Impact: No queue-based job processing, no job retries, no priority queues, no worker concurrency control.

---

## CORE FEATURES — PRESENT

### Background Location Collection
- **File:** `mobile/src/services/location.js`
- Uses `expo-location` + `expo-task-manager` (`LOCATION_TASK_NAME = 'gravity-background-location'`)
- Background permissions requested; foreground service notification configured for Android
- Distance interval: 50 m; deferred update interval: 60 s

### Traccar Webhook Integration
- **File:** `backend/src/webhooks/traccar.js`
- Webhook secret validated via `x-traccar-secret` header
- Extracts `deviceId, lat, lon, speed, course, altitude, accuracy, attributes` from Traccar payload
- Writes both historical (`device_locations`) and latest (`user_latest_locations`) records

### PostGIS ST_Contains Geofencing
- **File:** `backend/src/services/geofence.js`
- Query uses `ST_Contains(sz.geom, ST_SetSRID(ST_GeomFromText($1), 4326))` exactly as specified
- Iterates all safe zones the user belongs to

### Entry/Exit Detection for Safe Zones
- **File:** `backend/src/services/geofence.js`
- State-machine logic: compares current containment result against last recorded `event_type`
- Inserts `'entry'` event when inside and last event was not entry
- Inserts `'exit'` event when outside and last event was entry
- Push notifications sent to all other circle members via Expo Push API

### Pre-signed URL Upload to R2
- **File:** `backend/src/routes/media.js`
- `POST /media/avatar/presign` and `POST /media/circle/:circleId/icon/presign` generate signed PUT URLs (5-minute expiry)
- Mobile `ProfileScreen.jsx` fetches pre-signed URL then PUTs directly to R2

### URL Storage in PostgreSQL
- **File:** `backend/src/routes/media.js`
- `POST /media/avatar/confirm` stores `publicUrl` in `users.avatar_url`
- `POST /media/circle/:circleId/icon/confirm` stores `publicUrl` in `circles.icon_url`

---

## CORE FEATURES — MISSING

### SLC APIs (Background Location Collection via SLC APIs)
- **Status: MISSING**
- The design document specifies "Background location collection via SLC APIs" (Stop Location Collection / Significant Location Change APIs).
- The implementation uses `expo-location` `startLocationUpdatesAsync` with a fixed distance interval (50 m), not SLC/significant-location-change APIs.
- Neither iOS `CLLocationManager.startMonitoringSignificantLocationChanges()` nor Android equivalent is referenced anywhere.
- Impact: Higher battery drain than the SLC approach; may not match spec intent for power-efficient tracking.

---

## DATA FLOWS — PRESENT

### Location Flow: React Native → Caddy → Traccar → Express → PostGIS → Notification Gateway
- Mobile background task POSTs OsmAnd-compatible HTTP to `gravity.trackalways.com/telemetry` (React Native → Caddy)
- Caddy proxies to Traccar on port 8082 (Caddy → Traccar)
- Traccar POSTs to Express webhook `POST /webhooks/traccar/location` (Traccar → Express)
- Express writes `ST_GeomFromText(POINT(...))` to PostGIS tables (Express → PostGIS)
- Express calls `checkGeofenceStatus` and `sendToCircleMembers` for SSE push (PostGIS → Notification Gateway)
- **Full chain is implemented.**

### Media Flow: React Native → Express → Pre-signed URL → R2 → PostgreSQL
- Mobile requests pre-signed URL from Express (`POST /api/v1/media/avatar/presign`)
- Mobile uploads directly to R2 using the signed URL
- Mobile confirms with Express (`POST /api/v1/media/avatar/confirm`)
- Express stores public URL in PostgreSQL
- **Full chain is implemented.**

---

## COUNTRY SUPPORT — PRESENT

- **File:** `backend/src/routes/auth.js` (line 12)
- `country_code: z.enum(['KE', 'IN', 'AE', 'GB', 'US']).default('IN')`
- All five mandated countries present: Kenya (KE), India (IN), UAE (AE), UK (GB), USA (US)
- Country code stored in `users` table with `NOT NULL DEFAULT 'IN'`

---

## EXCLUDED FEATURES — NONE FOUND

A full grep across all `.js`, `.jsx`, `.ts`, `.tsx` files was run for each excluded category:

| Excluded Feature | Search Terms | Result |
|---|---|---|
| AI features | `openai`, `anthropic`, `langchain`, `AI` | Not found |
| WebSockets | `WebSocket`, `socket.io`, `ws://` | Not found |
| Kubernetes | `kubernetes`, `k8s` | Not found |
| Redis cluster | `redis`, `Redis` | Not found |
| Analytics | `analytics`, `segment`, `amplitude` | Not found |
| Billing | `billing`, `stripe` | Not found |
| Chat | `chat` (as feature, not comment) | Not found |
| Voice/Video | `voice`, `video` | Not found |
| BullMQ | `bullmq`, `bull` | Not found (also means BullMQ requirement is unmet) |

The implementation is clean of all prohibited features.

---

## FINDINGS SUMMARY

### PRESENT and COMPLIANT
1. Caddy Server with TLS, SSE buffering (`flush_interval -1`), Traccar proxy
2. Expo 54 (`~54.0.0`) + React Native 0.81 (`0.81.0`) — exact version match
3. Traccar middleware: HTTP telemetry ingestion, webhook handler
4. Node.js >=20 + Express 5.2.x — exact spec match
5. PostgreSQL via Neon Cloud + PostGIS extension + GIST indexes
6. Cloudflare R2 object storage with S3-compatible SDK
7. SSE (Server-Sent Events) — no WebSockets used anywhere
8. node-cron background jobs (location cleanup + geofence event cleanup)
9. Background location collection (expo-task-manager)
10. Traccar webhook integration with secret authentication
11. `ST_Contains` geofencing with entry/exit state machine
12. Pre-signed URL upload to R2 + URL storage in PostgreSQL
13. All 5 country codes: KE, IN, AE, GB, US
14. Zero excluded features present

### MISSING / NON-COMPLIANT
1. **BullMQ** — document specifies `node-cron → BullMQ`; only `node-cron` is present. BullMQ must be added for queue-based job processing.
2. **SLC APIs** — document specifies "Background location collection via SLC APIs"; implementation uses fixed-interval distance-based updates (`distanceInterval: 50`) instead of Significant Location Change APIs.

---

## RECOMMENDATIONS

1. **Add BullMQ:** Install `bullmq` and migrate the two cron cleanup jobs (and any future jobs such as geofence notification delivery) to BullMQ workers. Keep `node-cron` as the scheduler that enqueues BullMQ jobs, matching the `node-cron → BullMQ` specification.

2. **Implement SLC APIs:** On iOS, enable `CLLocationManager.startMonitoringSignificantLocationChanges()` via a native module or Expo config plugin. On Android, use `LocationRequest.PRIORITY_LOW_POWER` or geofence-trigger-style updates. The current `distanceInterval: 50` + `deferredUpdatesInterval: 60000` is a partial substitute but does not match the spec's SLC API requirement.
