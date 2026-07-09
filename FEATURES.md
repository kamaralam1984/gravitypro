# GravityPro — Features Breakdown

Family safety / location-tracking product. **100% FREE — koi paid/subscription/billing nahi.**
Do hisse hain: **Website (web app)** aur **Mobile App (React Native / Expo)** + ek **Backend API** (Node/Express + PostgreSQL/PostGIS) + ek **self-hosted routing engine** (OSRM).

> Last updated: 2026-07-09 · Mobile APK: **v1.0.3** (naya native build queue mein — background-heartbeat feature ke saath) · Live: gravitypro.kvlbusinesssolutions.com
> Aaj ke fixes: Child Hub Timeline ab road-snapped map + Route Replay dikhata hai · mobile mein naya **Alert Preferences** (family arrivals/SOS/safe-zone toggles) · **battery-low alert** ab live tracking path par bhi reliably fire hota hai (pehle sirf offline-sync ke baad fire hota tha)

---

## 🌐 WEBSITE (landing-react) — 3 roles: Admin, Parent, Child

### Public
- Home landing page, Terms, Privacy, Share page (no Pricing/Checkout — removed)
- Login/Register — **email-only OTP** (phone sirf optional contact info hai, login credential nahi), Parent/Child, country select

### Parent Dashboard (`/parent/panel`)
- Live map (Dark/Light/Satellite/Street), member markers, battery + last-seen, location history
- Family circles — create/join via invite code, multi-circle switch, leave, **delete circle (admin-only)**
- Family member cards — **Call / Message** shortcuts direct se
- **Safe Zones / geofence** — create/edit/delete, radius, **per-child assignment + category** (home/school/tuition/playground/music/dance), entry/exit alerts, green circles drawn on map, **distance to nearest zone** shown
- **Add Child** (parent-created child profile + DOB)
- **Emergency Contacts** — add/list/delete (also alerted on SOS)
- **Weekly Reports** — per-member: total distance, time at home/school, per-day breakdown, **Download CSV**
- **Location Precision** (Exact/Approx) — ab real setting hai, backend mein save hoti hai aur mobile ki GPS accuracy ko actually control karti hai
- **"View Child Panel"** — parent apne account ka child-style view preview kar sakta hai (pehle ye button broken tha, ab fix ho gaya)
- Alerts (SOS + geofence, SSE live), profile/avatar, account deletion
- Admin panel (`/admin/panel`) — users/ban, circles, event logs, system + OTP/SMS monitoring

### Travel Timeline (`/parent/timeline`)
- Har din ka route history — **ab road-snapped hai** (sadkon ko follow karta hai, seedhi line nahi) — self-hosted OSRM se power hota hai
- Transport-mode color-coded segments (walking/cycling/vehicle/stationary), direction arrows, start/end markers
- **Route Replay** — ek din ka safar animate karke dekh sakte ho (1x/2x/4x speed), road-snapped path ke saath
- Smart Places — visited locations, category detection

---

## 📱 MOBILE APP (mobile/) — Expo SDK 54, com.trackalways.gravity

### Bottom tabs
1. **Home** — family status, avatars, battery, **transport mode chip** (walk/cycle/vehicle), SOS, Mark Safe
2. **Map (Live Map)** — live family locations, safe zones (per-child) + distance, transport mode, SOS modal; **ab har member ka live trail bhi road-snapped hota hai** (OSRM se, seedhi line nahi)
3. **Circles** — family circles, member roster, add circle, tap child → Child Hub; **Call/Message member ko seedhe**, **Delete Family Circle (admin-only)**
4. **Alerts** — All / SOS / Geofence / Device tabs (battery-low, GPS-off, offline), SSE live
5. **Dashboard (Panel)** — WebView of web panel (SSO), OTA-updatable; **"View Child Panel"** entry point Profile se
6. **Profile** — edit name/email, avatar upload, location history, logout; **Family section → Add Child + Emergency Contacts + View Child Panel**; **Settings → Location Precision (Exact/Battery Saver), Improve Tracking Reliability, Language**; **Alert Preferences → Family Arrivals / SOS Alerts / Safe Zone Entry-Exit toggles** (naya — pehle mobile par ye settings dikhti hi nahi thi)

### Child Hub (parent → child tap)
- **Location Timeline** (stays & trips by day) — header se ek tap mein **road-snapped route map + Route Replay** (1x/2x/4x) bhi khulta hai us specific child ke liye (naya — pehle sirf self-view mein milta tha) · **Safe Zones** (per-child create + category) · **Weekly Report** (distance, home/school time, CSV)

### Native capabilities
- **Background location** — Android foreground service + iOS background mode, **offline queue** (net off → records locally → syncs on reconnect)
- **Online/Offline status** — 60-second foreground heartbeat + **naya periodic background heartbeat (~15 min, phone band/stationary hone par bhi Online dikhta hai)** — Android par near-guaranteed (battery-optimization permission ke saath), iOS par best-effort (Apple ki OS-level limitation, koi bhi app 100% guarantee nahi de sakti)
- **Location Precision** — Exact (default) ya Battery Saver mode, GPS accuracy/interval actually badalta hai
- **Reliability** — battery-optimization-ignore prompt + OEM auto-start deep-links (Xiaomi/Oppo/Vivo/Realme/Huawei), **ab Settings se dobara bhi trigger kar sakte ho** ("Improve Tracking Reliability")
- **Device alerts** — battery-low / GPS-off / device-offline (server-side monitor); **battery-low ab live-tracking path par bhi fire hota hai** (bug fix — pehle sirf offline-queue sync ke baad hi fire hota tha, normal online use mein kabhi nahi)
- **Transport mode** derived from GPS speed
- Push notifications, camera/photo (avatar), haptics, **OTA updates** (JS changes turant, native changes ke liye naya build chahiye)

---

## 🛠️ BACKEND (backend/) — Node/Express + PostgreSQL + PostGIS

- Auth (**email-only OTP**, phone optional), circles (create/join/leave/**delete**), geofences (per-child via `assigned_user_id` + `category`), locations, timeline, SSE realtime
- **Email delivery** — self-hosted domain (`gravitypro.kvlbusinesssolutions.com`) via Resend SMTP relay — reliable OTP delivery (pehle Gmail SMTP se IPv6 routing issue tha)
- **family** routes — parent-created child profiles (`users.dob`, age computed), emergency contacts
- **device** routes + `deviceMonitor` — battery-low/GPS-off/offline alerts (`device_status`)
- **reports** — weekly aggregate + time-at-home/school + CSV export
- **media** — local-disk image upload (`/media/upload` + `/media/file/:name`) — avatars/child photos without external object store
- **routing** — `/api/v1/routing/segment` + `/routing/path` — proxies self-hosted OSRM, Postgres-cached, retry + graceful straight-line fallback agar OSRM down ho
- **Traccar** hardware GPS-tracker / smart-watch ingestion (`tracker_devices`, webhook) — needs operator to self-host Traccar
- **SMS gateway** (pluggable MSG91/Twilio via env) — emergency-contact SOS SMS (log-only until a provider key is set)
- **Daily automated backup** — database + code, `/var/backups/gravitypro/<date>/`, 14-din retention
- Migrations 001–028 applied (zones, profiles+contacts, device_status, devices, route_cache, location_precision, etc.)

---

## 🗺️ SELF-HOSTED ROUTING (osrm/) — road-snapped GPS routes

- **Self-hosted OSRM** (Docker, apna server par) — public OSRM demo server kabhi use nahi hota (unki policy production ke liye allow nahi karti)
- Abhi coverage: **Eastern Zone** (Bihar, Jharkhand, Odisha, West Bengal) — poore India tak baad mein expand ho sakta hai (VPS resources allow karein to)
- Live Map ke live trails aur Timeline ke history routes — dono road-following hain, straight-line nahi
- OSRM down ho jaye to bhi app kaam karta rehta hai (straight-line fallback, koi crash nahi)

---

## ✅ Family-tracking workflow coverage
1. Parent registration + **child profile + age + photo** ✅
2. Child device setup (app) ✅ · hardware GPS/watch code-ready (needs Traccar self-host)
3. Location collection (~5s) ✅
4. Live tracking + **transport mode + road-snapped route** ✅
5. **Geofencing — per-child distinct zones** ✅
6. Alerts — geofence/SOS + battery-low/GPS-off/offline ✅
7. Route history (stays/trips, duration, **road-snapped + replay**) ✅
8. Emergency mode — SOS + emergency contacts (+SMS) ✅
9. Reports — weekly + distance + home/school time + CSV ✅
10. **Reliable online/offline status** — background heartbeat, app band hone par bhi ✅

---

## 🔑 Website vs Mobile
| Capability | Website | Mobile |
|---|---|---|
| Map / family / circles / alerts / SOS | ✅ | ✅ |
| Road-snapped routes (live + history) | ✅ | ✅ |
| Per-child safe zones + distance | ✅ | ✅ |
| Add child / emergency contacts / weekly report | ✅ | ✅ |
| Call/Message member shortcut | ✅ | ✅ |
| Delete Family Circle | ✅ | ✅ |
| Location Precision (real setting) | ✅ | ✅ |
| View Child Panel preview | ✅ | ✅ |
| Alert Preferences (arrivals/SOS/safe-zone toggles) | ✅ (ChildPanel) | ✅ |
| Admin panel | ✅ | ❌ |
| Background location / offline queue / reliability | ❌ | ✅ native |
| Background heartbeat (app closed → still online) | ❌ (n/a) | ✅ native |
| Device alerts (battery/GPS/offline) in-app feed | ❌ | ✅ |
| Push notifications | ❌ | ✅ |
| App Language switcher | ❌ (English only) | ❌ (English only, display row) |
| Screen-time / App-lock / Subscription | ❌ removed | ❌ removed |

> Net OFF → live location nahi, par offline queue net wapas aane par trail sync kar deta hai. Sab features FREE.

---

## ⚙️ Operator setup (optional, code ready)
- **Real SMS:** set `MSG91_AUTH_KEY`+`MSG91_SENDER` (or `TWILIO_ACCOUNT_SID`/`AUTH_TOKEN`/`FROM`) on VPS → `pm2 restart gravity-api`
- **Hardware tracker:** self-host Traccar, forward webhook to `<API>/webhooks/traccar` + nginx `location /webhooks { proxy_pass http://127.0.0.1:8002; }`
- **OSRM coverage expand:** `osrm/scripts/prepare-extract.sh` mein `REGION` badlo, dubara chalao (VPS RAM/disk allow kare to)
- **APK:** https://gravitypro.kvlbusinesssolutions.com/downloads/GravityPro.apk
