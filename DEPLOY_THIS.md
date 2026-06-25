# Deploy — 4 fixes (safe-zone toggle, child privacy/notif, Google btn, speeding) + earlier online-status

Pushed to `shivam-repo`. Mobile OTA auto-publishes via GitHub Action.
Run on the VPS (Hostinger web terminal):

```bash
cd /var/www/gravitypro          # prod checkout path
git pull origin shivam-repo

# 1) DB migration (NEW: 019 — adds safe_zones.active, users settings cols, device_status.speeding_alerted)
cd backend && node src/db/migrate.js && cd ..

# 2) website rebuild (parent zone-toggle + child settings UI)
cd landing-react && npm ci && npm run build && cd ..

# 3) restart services
pm2 restart gravity-api gravity-web

# 4) verify
pm2 logs gravity-api --lines 20
```

## What shipped
- **#2 Safe-zone ON/OFF** now persists (`PATCH /geofences/:id {active}`) and inactive zones are skipped by geofence checks.
- **#1 Child privacy** — `share_location` + notification prefs persisted & ENFORCED server-side:
  - "Share my location" OFF → backend drops location posts + heartbeat (no store, no broadcast).
  - Notification toggles gate geofence + SOS push to that recipient. New `GET/PATCH /users/me/settings`.
- **#3 Google sign-in** — removed the dead "Coming soon" button (backend `/auth/google` stays ready; needs Google OAuth client IDs to re-enable).
- **#4 Speeding alert** — server sends a `speeding` device-alert when GPS speed > `speed_alert_kmh` (default 80), with hysteresis.

## Mobile (automatic on push)
- `ota-update.yml` publishes the Expo OTA (LoginScreen change). Installed apps live-update on next launch.
- Note: the child privacy toggles live in the **web** child panel; the mobile app's existing tracking toggle (ProfileScreen) is unchanged.
