# GravityPro — Features Breakdown

Family safety / location-tracking product. **100% FREE — koi paid/subscription/billing nahi.**
Do hisse hain: **Website (web app)** aur **Mobile App (React Native / Expo)** + ek **Backend API** (Node/Express + PostgreSQL/PostGIS).

> Last updated: 2026-06-25 · Mobile APK: **v1.0.3 (versionCode 7)** · Live: gravitypro.kvlbusinesssolutions.com

---

## 🌐 WEBSITE (landing-react) — 3 roles: Admin, Parent, Child

### Public
- Home landing page, Terms, Privacy, Share page (no Pricing/Checkout — removed)
- Login/Register — phone + email, OTP verify, Parent/Child, country select

### Parent Dashboard (`/parent/panel`)
- Live map (Dark/Light/Satellite/Street), member markers, battery + last-seen, location history
- Family circles — create/join via invite code, multi-circle switch, leave
- **Safe Zones / geofence** — create/edit/delete, radius, **per-child assignment + category** (home/school/tuition/playground/music/dance), entry/exit alerts, green circles drawn on map, **distance to nearest zone** shown
- **Add Child** (parent-created child profile + DOB)
- **Emergency Contacts** — add/list/delete (also alerted on SOS)
- **Weekly Reports** — per-member: total distance, time at home/school, per-day breakdown, **Download CSV**
- Alerts (SOS + geofence, SSE live), profile/avatar, account deletion
- Admin panel (`/admin/panel`) — users/ban, circles, event logs, system + OTP/SMS monitoring

---

## 📱 MOBILE APP (mobile/) — Expo 54, v1.0.3 (versionCode 7), com.trackalways.gravity

### Bottom tabs
1. **Home** — family status, avatars, battery, **transport mode chip** (walk/cycle/vehicle), SOS, Mark Safe
2. **Map** — live family locations, **safe zones (per-child)** + distance, transport mode, SOS modal; +/- zoom control lower-positioned
3. **Circles** — family circles, member roster, add circle, tap child → Child Hub
4. **Alerts** — All / SOS / Geofence / **Device** tabs (battery-low, GPS-off, offline), SSE live
5. **Dashboard (Panel)** — WebView of web panel (SSO), OTA-updatable
6. **Profile** — edit name/email, **avatar upload (local-disk, no R2)**, location history, logout; **Family section → Add Child + Emergency Contacts**

### Child Hub (parent → child tap)
- **Location Timeline** (stays & trips by day) · **Safe Zones** (per-child create + category) · **Weekly Report** (distance, home/school time, CSV)

### Native capabilities
- **Background location** — Android foreground service + iOS background mode, **offline queue** (net off → records locally → syncs on reconnect)
- **Reliability** — battery-optimization-ignore prompt + OEM auto-start deep-links (Xiaomi/Oppo/Vivo/Realme/Huawei) — keeps tracking alive in background
- **Device alerts** — battery-low / GPS-off / device-offline (server-side monitor)
- **Transport mode** derived from GPS speed
- Push notifications, camera/photo (avatar), haptics, OTA updates

---

## 🛠️ BACKEND (backend/) — Node/Express + PostgreSQL + PostGIS
- Auth (phone/email OTP), circles, geofences (**per-child via `assigned_user_id` + `category`**), locations, timeline, SSE realtime
- **family** routes — parent-created child profiles (`users.dob`, age computed), emergency contacts
- **device** routes + `deviceMonitor` — battery-low/GPS-off/offline alerts (`device_status`)
- **reports** — weekly aggregate + time-at-home/school + CSV export
- **media** — local-disk image upload (`/media/upload` + `/media/file/:name`) — avatars/child photos without external object store
- **Traccar** hardware GPS-tracker / smart-watch ingestion (`tracker_devices`, webhook) — needs operator to self-host Traccar (see `backend/TRACCAR_SETUP.md`)
- **SMS gateway** (pluggable MSG91/Twilio via env) — emergency-contact SOS SMS (log-only until a provider key is set)
- Migrations 012–015 applied (zones, profiles+contacts, device_status, devices)

---

## ✅ Family-tracking workflow coverage
1. Parent registration + **child profile + age + photo** ✅
2. Child device setup (app) ✅ · **hardware GPS/watch** code-ready (needs Traccar self-host)
3. Location collection (~3s) ✅
4. Live tracking + **transport mode** ✅
5. **Geofencing — per-child distinct zones** ✅ (Aarav: Home/SchoolA/TuitionA/Playground · Anaya: Home/SchoolB/Music/Dance, etc.)
6. Alerts — geofence/SOS + **battery-low/GPS-off/offline** ✅
7. Route history (stays/trips, duration) ✅
8. Emergency mode — SOS + **emergency contacts (+SMS)** ✅
9. Reports — **weekly + distance + home/school time + CSV** ✅

---

## 🔑 Website vs Mobile
| Capability | Website | Mobile |
|---|---|---|
| Map / family / circles / alerts / SOS | ✅ | ✅ |
| **Per-child safe zones + distance** | ✅ | ✅ |
| Add child / emergency contacts / weekly report | ✅ | ✅ |
| Admin panel | ✅ | ❌ |
| Background location / offline queue / reliability | ❌ | ✅ native |
| Device alerts (battery/GPS/offline) in-app feed | ❌ | ✅ |
| Push notifications | ❌ | ✅ |
| Screen-time / App-lock / Subscription | ❌ removed | ❌ removed |

> Net OFF → live location nahi, par offline queue net wapas aane par trail sync kar deta hai. Sab features FREE.

---

## ⚙️ Operator setup (optional, code ready)
- **Real SMS:** set `MSG91_AUTH_KEY`+`MSG91_SENDER` (or `TWILIO_ACCOUNT_SID`/`AUTH_TOKEN`/`FROM`) on VPS → `pm2 restart gravity-api`
- **Hardware tracker:** self-host Traccar, forward webhook to `<API>/webhooks/traccar` + nginx `location /webhooks { proxy_pass http://127.0.0.1:8002; }`
- **APK:** https://gravitypro.kvlbusinesssolutions.com/downloads/GravityPro.apk
