# GRAVITY — Full System Documentation
> Trackalways Limited · Family Safety & Location Tracking Platform
> Last updated: June 2026

---

## TABLE OF CONTENTS
1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Routing & Pages](#3-routing--pages)
4. [Authentication System](#4-authentication-system)
5. [Child Panel — Full Feature Breakdown](#5-child-panel)
6. [Parent Panel — Full Feature Breakdown](#6-parent-panel)
7. [Admin Panel — Full Feature Breakdown](#7-admin-panel)
8. [Landing Page (Home)](#8-landing-page)
9. [Backend API Routes](#9-backend-api-routes)
10. [Database Schema](#10-database-schema)
11. [Real-Time System (SSE)](#11-real-time-system-sse)
12. [Media / File Upload System](#12-media--file-upload-system)
13. [Geofence System](#13-geofence-system)
14. [SOS Alert System](#14-sos-alert-system)
15. [Environment Variables](#15-environment-variables)
16. [Server Setup](#16-server-setup)

---

## 1. SYSTEM OVERVIEW

**Project Name:** Gravity (brand) / Trackalways (company name)
**Type:** Web-based family safety & location tracking platform
**Target:** Mobile-first responsive web app (phone-frame UI on desktop, fullscreen on mobile)
**UI Theme:** Dark green premium (#050C08 background, #00E676 accent)
**Font:** Plus Jakarta Sans
**Company:** Trackalways Limited
**Copyright:** © 2026 Trackalways Limited

### Core Concept
Parents can monitor their children and family members in real-time on a map. Children can send SOS alerts in emergencies. Family circles group members together. Safe zones (geofences) trigger automatic alerts on entry/exit.

---

## 2. ARCHITECTURE

```
┌─────────────────────────────────────────────────────────┐
│                   CLIENT (React SPA)                    │
│  Port 8090 — landing-react/server.cjs (HTTP proxy)      │
│                                                         │
│  Pages: Home / Login / Parent / ParentPanel /           │
│         Child / ChildPanel / AdminLogin / AdminPanel    │
└────────────────────┬────────────────────────────────────┘
                     │ /api/* proxy
                     ▼
┌─────────────────────────────────────────────────────────┐
│               EXPRESS BACKEND (Node.js)                 │
│  Port 8002 — Express 5.2.x                              │
│                                                         │
│  Routes: auth / users / circles / geofences /           │
│          locations / media / sos / sse / admin          │
└────────────────────┬────────────────────────────────────┘
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
┌──────────────────┐   ┌──────────────────┐
│  PostgreSQL DB   │   │  Cloudflare R2   │
│  + PostGIS ext   │   │  (Avatar Storage)│
│  (spatial SQL)   │   │                  │
└──────────────────┘   └──────────────────┘
```

### Tech Stack
| Layer       | Technology                              |
|-------------|------------------------------------------|
| Frontend    | React 18 + TypeScript + Vite             |
| Routing     | React Router v6                          |
| Maps        | Leaflet.js (loaded via CDN)              |
| Backend     | Express.js 5.2.x (Node.js)              |
| Database    | PostgreSQL + PostGIS extension           |
| Auth        | JWT (jsonwebtoken) + bcryptjs            |
| Validation  | Zod (backend schema validation)         |
| SMS         | MSG91 (OTP delivery)                    |
| Storage     | Cloudflare R2 (S3-compatible)           |
| Real-time   | Server-Sent Events (SSE)                |
| Styling     | CSS Modules (per-component)             |

---

## 3. ROUTING & PAGES

```
/                   → Home.tsx          (Landing page)
/login              → Login.tsx         (Phone OTP login/register)
/parent             → Parent.tsx        (Parent marketing page)
/parent/panel       → ParentPanel.tsx   (Parent dashboard — auth required)
/parent-panel       → redirect → /parent/panel
/child              → Child.tsx         (Child marketing page)
/child/panel        → ChildPanel.tsx    (Child dashboard — auth required)
/child-panel        → redirect → /child/panel
/admin              → redirect → /admin/login
/admin/login        → AdminLogin.tsx    (Admin password login)
/admin/panel        → AdminPanel.tsx    (Admin dashboard — admin auth required)
```

### Server (landing-react/server.cjs)
- Runs on port **8090**
- Proxies all `/api/*` requests to backend at port **8002**
- Handles SSE streaming correctly (no buffering, keep-alive)
- SPA fallback: serves `index.html` for all unknown routes

---

## 4. AUTHENTICATION SYSTEM

### User Authentication (Phone OTP)
1. **Send OTP:** `POST /api/v1/auth/send-otp` → generates 6-digit OTP, stores in `phone_otps`, sends via MSG91
2. **Rate limit:** Max 3 OTPs per phone per 10 minutes
3. **OTP expiry:** 10 minutes
4. **Login:** `POST /api/v1/auth/login` → verifies OTP + password → returns JWT
5. **Register:** `POST /api/v1/auth/register` → verifies OTP → creates user → returns JWT

**JWT Storage:** `localStorage.gravity_token`
**User Object:** `localStorage.gravity_user` (JSON: id, name, phone, email, role, avatar_url, created_at)
**Auth Header:** `Authorization: Bearer <token>`

### Google Sign-In
- Google GSI (Google Sign-In) script loaded dynamically
- `window.handleGoogleCredential` callback processes Google JWT
- Falls back to manual Google sign-in button if one-tap doesn't appear in 2.5s

### Admin Authentication
1. **Login:** `POST /api/v1/admin/login` with `{ password }` → checked against `ADMIN_SECRET` env var
2. **Returns:** JWT with `{ role: 'admin' }` payload, expires in 12 hours
3. **Storage:** `localStorage.admin_token`
4. **Auth Header:** `x-admin-token: <token>` (all admin API calls)
5. **Token check on load:** AdminLogin.tsx auto-redirects to `/admin/panel` if valid token exists

### Auth Guards
- ChildPanel: if no `gravity_token` → redirect to `/login?redirect=/child/panel`
- ParentPanel: if no `gravity_token` → redirect to `/login?redirect=/parent/panel`
- AdminPanel: if no `admin_token` → redirect to `/admin/login`
- 401 responses → clear localStorage → redirect to login

---

## 5. CHILD PANEL

**URL:** `/child/panel`
**Auth:** JWT required (gravity_token)
**UI:** Phone-frame mockup (max-width 430px), 6-tab bottom navigation

### Bottom Navigation Tabs
```
🏠 Home  |  🗺️ Map  |  🆘 SOS (center, floating red)  |  👨‍👩‍👦 Family  |  🔔 Alerts  |  👤 Profile
```

---

### TAB 1: HOME
**Purpose:** Quick status overview + emergency SOS

**Sections:**
1. **Status Bar** — clock (12-hr), signal bars, WiFi, battery (CSS animated)
2. **Header** — Gravity logo (SVG pin), "Welcome back / Hey, {Name}" + avatar
3. **My Status Card** — greeting (morning/afternoon/evening + emoji), "Your family can see your location" with pulsing green dot
4. **Location Card** — "Location sharing active" + last updated time + live lat/lng coords + LIVE badge
5. **SOS Button (Home)** — 140px red circle, 3 animated rings, hold 3 seconds to activate
   - Countdown: 3→2→1 with flash animation, releases = cancels
   - Sends: GPS coordinates + "SOS! I need help!" to all circle members
6. **Quick Actions** (2×2 grid):
   - ✅ **I'm Safe** → `POST /api/v1/sos/safe` + toast
   - 📍 **Share Location** → copies `{origin}/share?uid={id}` to clipboard
   - 🔔 **Arrive Safe** → shows coordinates in toast (notification placeholder)
   - 💬 **Message Family** → switches to Family tab
7. **Family Circle strip** — horizontal scroll, avatar rings with online/offline dot
   - Own avatar (always first, green glow)
   - Other members with color-coded rings
   - Click → shows name/status/coordinates in toast

**Logic:**
- `updateTime()` runs every 30s, updates greeting + status bar clock
- GPS watch via `navigator.geolocation.watchPosition`, throttled to POST every 30s
- Battery via `navigator.getBattery()` API, fallback 75%

---

### TAB 2: MAP
**Purpose:** See all family members on live map

**Features:**
- Leaflet.js map (dark CDN tiles by default)
- **4 tile types:** 🌙 Dark / ☀️ Light / 🛰️ Satellite / 🗺️ Street
- **Member markers:** Avatar photo circles with color-coded rings + name labels
  - Own marker: 52px, labeled "📍 You"
  - Others: 44px, labeled with first name
  - Popup on click: name, role, battery%, status
- **Zoom controls:** + / − buttons (custom, not Leaflet default)
- **Auto-fit:** fitBounds to show all located members
- **Nearest Member Card** — shows first other member's avatar + location status
- **Distance badges** — colored dot + name for each member

**Map Init Logic:**
- Map only initializes on first tab switch to 'map'
- Leaflet CSS injected dynamically if not present
- SSE location_update events move markers in real-time without reload

---

### TAB 3: SOS (Center Tab)
**Purpose:** Emergency alert system

**Sections:**
1. **GPS Status Bar** — 🛰️ Active (green) / 📵 Off (red)
2. **Big SOS Button** — 160px, 3 animated rings, "PRESS & HOLD" instruction
   - Same hold-3-seconds logic as Home SOS
   - GPS coordinates fetched fresh on activation
3. **Quick Messages** (2×2 grid):
   - 🆘 "I need help!" (red)
   - ⚠️ "I'm in danger!" (orange)
   - 📞 "Call me now!" (blue)
   - 🚗 "Come pick me up!" (green)
   - Each: `POST /api/v1/sos` with message + current GPS
4. **Emergency Contacts** — all other circle members
   - Avatar, name, role, online status
   - **Call button** → `tel:` link (if phone stored) or toast warning
   - **Emergency Services** card → always shows "112 · Police / Ambulance" → `tel:112`

---

### TAB 4: FAMILY
**Purpose:** View all circle members

**States:**
- `hasCircle === null` → "Loading..."
- `hasCircle === false` → Join Circle box:
  - 📷 QR code placeholder
  - Invite code input (A-Z 0-9 only, 12 chars max)
  - `POST /api/v1/circles/join` → reloads page on success
- `hasCircle === true` → Member cards

**Member Card:**
- Avatar with online/offline ring
- Name (with "(You)" label for self)
- Role (parent/child/member/admin)
- Battery bar + percentage (green >60%, amber >20%, red ≤20%)
- Online status dot
- "📍 Located" badge (top-right, if coordinates available)
- 🗺️ **View on Map** button → switches to Map tab + centers on member

---

### TAB 5: ALERTS
**Purpose:** Notification history for geofence & SOS events

**Header:**
- "Alerts" title + filtered notification count
- "Clear All" button (appears when alerts exist)

**Filter Tabs:**
- **All** — all alerts combined
- **🔔 Geofence** — only geofence entry/exit events
- **🆘 SOS** — only SOS alerts

**Empty States (filter-aware):**
- All/Geofence: 🔔 icon
- SOS: 🆘 icon
- Context-appropriate subtitle text

**Alert Card:**
- Left border color: red (SOS), green (geofence entry), amber (geofence exit)
- Icon: 🆘 or 🔔
- Username + timestamp (relative: "Just now", "5m ago", "2h ago", "15 Jun")
- Message text

**Real-time:** SSE `geofence_event` and `sos_alert` events push new alerts
**Unread badge:** Red dot on Alerts nav tab, count resets when tab opened

---

### TAB 6: PROFILE
**Purpose:** Account management + settings

**Sections:**

**My Account Card (dark card):**
- Clickable avatar → file picker → R2 upload flow
  - Camera overlay on hover
  - Upload spinner during upload
  - ✏ edit badge (bottom-right)
- MEMBER/PARENT/CHILD role badge (green)
- Editable name input with "DISPLAY NAME" label
- Info rows (icon + subtle bg): ✉️ Email / 📞 Phone / 📅 Member since
- ✓ Save Profile button (full-width, gradient green)
  - `PATCH /api/v1/users/me` → updates name
  - Falls back to localStorage update if 404
- 🚪 Logout button (full-width, red outline, outside card)

**Location Sharing (toggles):**
- 📍 Share my location (on/off)
- 🎯 Location Precision: Exact / Approximate (segmented control)
- 🚨 Auto-share in SOS zone (on/off)
- All toggles persist to `localStorage.gravity_toggles`

**Notifications (toggles):**
- 🏠 Family arrivals
- 🆘 SOS alerts from family
- 📌 Geofence alerts

**Today's Activity (3 stat cards):**
- Distance Today → `GET /api/v1/users/me/stats` → `today.distance_km`
- Safe Zones Visited → `today.safe_zones_visited`
- Family Check-ins → `today.family_checkins`
- Shows "—" if no data

**Location History:**
- Refresh button → `GET /api/v1/users/me/location-history` → last 10 entries
- Entry: 📍 icon + distance from home OR coordinates + date/time + 🔋 battery%
- Auto-loads when Profile tab opened

**Bottom:**
- 🏠 Back to Home link
- "Gravity v1.0.0" version badge

---

## 6. PARENT PANEL

**URL:** `/parent/panel`
**Auth:** JWT required (gravity_token)
**UI:** Full-page web app with left sidebar navigation (not phone-frame)

### Sidebar Navigation
- 🏠 Dashboard
- 🗺️ Map (Live Map)
- 👥 Members
- 📌 Geofences (Safe Zones)
- 🔔 Alerts
- ⚙️ Settings / Profile
- 🚪 Logout (bottom)

---

### SECTION 1: DASHBOARD
**Stats Overview (4 stat cards):**
- Total Members in circle
- Active Now (online members)
- Safe Zones count
- SOS Alerts (today)

**Live Member Status Strip:**
- Horizontal scroll of member avatar cards
- Each: avatar, name, battery, online/offline indicator

**Recent Alerts Panel:**
- Last few geofence/SOS events with timestamps

---

### SECTION 2: LIVE MAP
- Leaflet.js map (same tile types as ChildPanel)
- All circle members plotted with color-coded avatar markers
- Real-time updates via SSE `location_update`
- Tile switcher: Dark / Light / Satellite / Street
- Zoom controls
- "ALL SAFE" badge (top right)
- Member distance badges (bottom strip)
- Nearest member card

---

### SECTION 3: MEMBERS
**Member management for circle owner**

**Member Cards:**
- Avatar, name, role, online/offline status
- Battery percentage + colored bar
- Last location coordinates (if available)
- 🗺️ View on Map button
- ❌ Remove member button (with confirmation dialog)
  - `DELETE /api/v1/circles/{circleId}/members/{memberId}`

**Invite New Member:**
- Circle invite code displayed
- Copy button
- QR code generation (visual)
- Regenerate code button → `PATCH /api/v1/circles/{id}/invite`

---

### SECTION 4: GEOFENCES (Safe Zones)
**Create Safe Zones:**
- Interactive Leaflet map with circle drawing
- Click map to place center point
- Adjust radius (slider/input)
- Name the zone
- `POST /api/v1/geofences` → creates zone
- Zone saved with: name, center_lat, center_lng, radius, circle_id

**Zone List:**
- Each zone: name, address, radius, active/inactive toggle
- Delete zone button
- Click zone → centers map on it

**Zone Events (Recent):**
- Entry/exit events for each zone with member name + timestamp

---

### SECTION 5: ALERTS
Same alert list as ChildPanel but from parent perspective:
- Filter: All / Geofence / SOS
- Each card shows which family member triggered it
- SOS cards have higher visual priority (red border)
- Dismiss individual alerts

---

### SECTION 6: SETTINGS / PROFILE
- Edit profile name, avatar upload (R2)
- Circle management: rename circle, view invite code
- Notification preferences toggles
- Account section: email, phone, member since
- Logout

---

## 7. ADMIN PANEL

**URL:** `/admin/panel`
**Auth:** Admin token required (`x-admin-token` header)
**UI:** Full desktop web app — dark sidebar + content area

### Sidebar Sections
- 📊 Dashboard
- 👥 Users
- 🔗 Circles
- 🆘 SOS Events
- 📌 Geofence Logs
- 🔑 OTP Logs
- ⚙️ System
- 📢 Broadcast

---

### SECTION 1: DASHBOARD
`GET /api/v1/admin/dashboard`

**Stat Cards (real DB queries):**
| Stat | Source |
|------|--------|
| Total Users | COUNT(*) FROM users |
| Parents | COUNT WHERE account_type='parent' |
| Children | COUNT WHERE account_type='child' |
| Banned | COUNT WHERE is_banned=TRUE |
| Total Circles | COUNT(*) FROM circles |
| Active Now | DISTINCT user_id WHERE updated_at > NOW()-5min |
| SOS Today | COUNT FROM sos_events WHERE created_at > NOW()-24h |
| Geofence Events | COUNT(*) FROM geofence_events |
| Location Points | COUNT(*) FROM device_locations |

---

### SECTION 2: USERS
`GET /api/v1/admin/users?page=1&search=&limit=20`

**Features:**
- Paginated user list (20 per page)
- Search by name / phone / email (ILIKE)
- **Table columns:** Name, Phone, Email, Role, Circles, Joined, Status, Actions
- **Ban/Unban toggle** → `PATCH /api/v1/admin/users/:id/ban` (toggles is_banned)
- **Delete user** → `DELETE /api/v1/admin/users/:id` (with confirmation dialog)
- Banned users shown with red badge
- Circle count shown per user

---

### SECTION 3: CIRCLES
`GET /api/v1/admin/circles`

**Table columns:** Circle Name, Owner, Phone, Members, Safe Zones, Invite Code, Created
**Actions:**
- 🔄 Regenerate invite code → `PATCH /api/v1/admin/circles/:id/invite`
- 🗑️ Delete circle → `DELETE /api/v1/admin/circles/:id` (with confirmation)

---

### SECTION 4: SOS EVENTS
`GET /api/v1/admin/sos`

**Table columns:** User, Phone, Circle, Location (lat/lng), Message, Time, Status, Action
**Actions:**
- ✅ Resolve SOS → `PATCH /api/v1/admin/sos/:id/resolve` → marks resolved=TRUE
- Unresolved events highlighted in red
- Last 100 SOS events shown

---

### SECTION 5: GEOFENCE LOGS
`GET /api/v1/admin/geofences`

**Table columns:** User, Phone, Zone Name, Circle, Event Type (Entry/Exit), Time
- Last 200 events
- Entry = green chip, Exit = red chip
- Sortable by time (DESC)

---

### SECTION 6: OTP LOGS
`GET /api/v1/admin/otps`

**Table columns:** Phone, OTP Code, Expires At, Used (✓/✗), Created At
- Last 100 OTP records
- Used for debugging SMS delivery issues
- Shows raw OTP codes (dev/debug tool)

---

### SECTION 7: SYSTEM INFO
`GET /api/v1/admin/system`

**Displays:**
- Database size (`pg_size_pretty`)
- All table names + live row counts
- Rate limit config (900s window, 1000 req max)
- Node.js version
- Server uptime (seconds → formatted)
- Connected SSE clients (live count)

**Danger Zone:**
- 🗑️ Purge Location History → `DELETE /api/v1/admin/locations/purge?days=30`
  - Input: days (default 30, min 1)
  - Deletes all device_locations older than N days
  - With double confirmation dialog

---

### SECTION 8: BROADCAST
`POST /api/v1/admin/broadcast`

**Features:**
- Message input (text)
- Type selector: info / warning / alert
- **Send** → pushes SSE event `admin_broadcast` to ALL connected clients
- Shows recipient count (connected SSE clients)
- ChildPanel/ParentPanel can listen for `admin_broadcast` events

---

## 8. LANDING PAGE

**URL:** `/`
**File:** `Home.tsx` (1424 lines)

### Sections (top to bottom):
1. **NAV** — Logo, links (Features/How it Works/Pricing/Download), Login/Get Started CTA
2. **HERO** — Headline ("Keep Your Family Safe, Always"), family member strip, live Leaflet map (right column), map type switcher, animated member markers with connection lines, sidebar distance badges
3. **PAIN POINT** — "Are you worried about..." emotional messaging
4. **FEATURES** (6 cards with inline SVG illustrations):
   - 🗺️ Live Location Tracking
   - 🏠 Safe Zones (Geofence)
   - 👨‍👩‍👦 Family Circles
   - 🆘 Emergency SOS
   - 🔋 Battery Monitoring
   - 🔒 Privacy Controls
5. **APP SCREENSHOTS** — 5 phone mockups (Live Map, SOS, Geofence, Battery, Alerts)
6. **STATS BAR** — 50K+ families · 5 countries · 99.9% uptime · <2s updates
7. **HOW IT WORKS** — 4-step timeline (Create → Invite → Share → Stay Safe)
8. **FOR PARENTS / FOR CHILDREN** — Split feature comparison
9. **COUNTRIES** — Supported regions
10. **TESTIMONIALS** — User reviews
11. **PRICING** — Free Forever / Pro (₹99/month)
12. **DOWNLOAD** — Google Play + App Store badges
13. **FOOTER** — Brand, social links, copyright "© 2026 Trackalways Limited"

### Landing Page Effects:
- Canvas particle network (animated dots + connection lines)
- Scroll reveal animations (IntersectionObserver)
- Stats counter animation on scroll (count up)
- Leaflet map with demo member markers + connection SVG lines
- Mobile hamburger menu

---

## 9. BACKEND API ROUTES

### Base URL: `/api/v1`

### auth.js — `/api/v1/auth/`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/send-otp` | None | Send 6-digit OTP to phone (MSG91 or console log) |
| POST | `/login` | None | Verify OTP + password → JWT token |
| POST | `/register` | None | Verify OTP → create user → JWT token |

### users.js — `/api/v1/users/`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/me` | JWT | Get current user profile |
| PATCH | `/me` | JWT | Update name/email/push_token |
| GET | `/search?phone=` | JWT | Find user by phone number |
| POST | `/location` | JWT | Save GPS point (lat/lng/accuracy/battery) |
| PATCH | `/location` | JWT | Update battery level only |
| GET | `/me/stats` | JWT | Today's activity (distance/safe zones/checkins) |
| GET | `/me/location-history` | JWT | Last 50 location points |

### circles.js — `/api/v1/circles/`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | JWT | List my circles |
| POST | `/` | JWT | Create new circle |
| POST | `/join` | JWT | Join circle via invite code |
| GET | `/:id/members` | JWT | List circle members with locations |
| DELETE | `/:id/members/:userId` | JWT | Remove member from circle |
| PATCH | `/:id/invite` | JWT | Regenerate invite code |

### geofences.js — `/api/v1/geofences/`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | JWT | List geofences for my circles |
| POST | `/` | JWT | Create safe zone |
| DELETE | `/:id` | JWT | Delete safe zone |
| GET | `/events` | JWT | Recent geofence events |

### locations.js — `/api/v1/locations/`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/` | JWT | Save location point (from Expo mobile) |
| GET | `/:userId/history` | JWT | Location history for user |

### sos.js — `/api/v1/sos/`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/` | JWT | Trigger SOS — broadcasts to all circle members via SSE + logs to DB |
| POST | `/safe` | JWT | Send "I'm safe" notification |
| GET | `/history` | JWT | Last 50 SOS events |

### sse.js — `/api/v1/sse/`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/stream?token=` | JWT (query param) | SSE connection — real-time event stream |

### media.js — `/api/v1/media/`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/avatar/presign` | JWT | Get R2 presigned upload URL |
| POST | `/avatar/confirm` | JWT | Confirm upload + save publicUrl to user |

### admin.js — `/api/v1/admin/`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/login` | None | Admin password login → JWT |
| GET | `/dashboard` | Admin | System-wide stats |
| GET | `/users` | Admin | Paginated user list with search |
| PATCH | `/users/:id/ban` | Admin | Toggle user ban status |
| DELETE | `/users/:id` | Admin | Delete user permanently |
| GET | `/circles` | Admin | All circles with owner info |
| DELETE | `/circles/:id` | Admin | Delete circle |
| PATCH | `/circles/:id/invite` | Admin | Regenerate invite code |
| GET | `/sos` | Admin | Last 100 SOS events |
| PATCH | `/sos/:id/resolve` | Admin | Mark SOS as resolved |
| GET | `/geofences` | Admin | Last 200 geofence events |
| GET | `/otps` | Admin | Last 100 OTP records |
| GET | `/system` | Admin | DB stats + server info + SSE count |
| DELETE | `/locations/purge?days=` | Admin | Purge old location data |
| POST | `/broadcast` | Admin | Broadcast SSE message to all clients |

---

## 10. DATABASE SCHEMA

### users
```sql
id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
name          TEXT NOT NULL
phone         TEXT UNIQUE
email         TEXT UNIQUE
password_hash TEXT
account_type  TEXT DEFAULT 'child'  -- 'parent' | 'child' | 'admin'
country_code  TEXT DEFAULT '+91'
avatar_url    TEXT
push_token    TEXT
is_banned     BOOLEAN DEFAULT FALSE
created_at    TIMESTAMPTZ DEFAULT NOW()
updated_at    TIMESTAMPTZ DEFAULT NOW()
```

### circles
```sql
id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
name        TEXT NOT NULL
invite_code TEXT UNIQUE NOT NULL
icon_url    TEXT
created_by  UUID REFERENCES users(id)
created_at  TIMESTAMPTZ DEFAULT NOW()
```

### circle_members
```sql
circle_id   UUID REFERENCES circles(id) ON DELETE CASCADE
user_id     UUID REFERENCES users(id) ON DELETE CASCADE
role        TEXT DEFAULT 'member'  -- 'admin' | 'member'
joined_at   TIMESTAMPTZ DEFAULT NOW()
PRIMARY KEY (circle_id, user_id)
```

### device_locations  (historical — PostGIS)
```sql
id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id     UUID REFERENCES users(id) ON DELETE CASCADE
geom        GEOMETRY(Point, 4326)  -- PostGIS spatial point
accuracy    FLOAT
speed       FLOAT
bearing     FLOAT
altitude    FLOAT
battery_level INTEGER
recorded_at TIMESTAMPTZ DEFAULT NOW()
```

### user_latest_locations  (live snapshot — PostGIS)
```sql
user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
geom          GEOMETRY(Point, 4326)
accuracy      FLOAT
battery_level INTEGER
updated_at    TIMESTAMPTZ DEFAULT NOW()
```

### safe_zones  (geofences)
```sql
id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
circle_id   UUID REFERENCES circles(id) ON DELETE CASCADE
name        TEXT NOT NULL
address     TEXT
center_lat  FLOAT NOT NULL
center_lng  FLOAT NOT NULL
radius      INTEGER DEFAULT 100  -- meters
active      BOOLEAN DEFAULT TRUE
created_at  TIMESTAMPTZ DEFAULT NOW()
```

### geofence_events
```sql
id           UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id      UUID REFERENCES users(id) ON DELETE CASCADE
safe_zone_id UUID REFERENCES safe_zones(id) ON DELETE CASCADE
event_type   TEXT NOT NULL  -- 'entry' | 'exit'
created_at   TIMESTAMPTZ DEFAULT NOW()
```

### sos_events
```sql
id         UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id    UUID REFERENCES users(id) ON DELETE CASCADE
user_name  TEXT
circle_id  UUID
latitude   FLOAT
longitude  FLOAT
message    TEXT
resolved   BOOLEAN DEFAULT FALSE
created_at TIMESTAMPTZ DEFAULT NOW()
```

### phone_otps
```sql
phone       TEXT NOT NULL
code        TEXT NOT NULL
expires_at  TIMESTAMPTZ NOT NULL
used        BOOLEAN DEFAULT FALSE
created_at  TIMESTAMPTZ DEFAULT NOW()
```

---

## 11. REAL-TIME SYSTEM (SSE)

### Connection
```
GET /api/v1/sse/stream?token={jwt}
Response: text/event-stream
```
- Token via query param (EventSource API limitation — no custom headers)
- Keep-alive ping every 25 seconds (`: ping\n\n`)
- On connect: sends `{ type: 'connected', userId }` confirmation

### SSE Events

| Event Name | Triggered By | Payload | Who Receives |
|------------|-------------|---------|--------------|
| `location_update` | POST /users/location | userId, latitude, longitude, accuracy, battery_level, timestamp | All members of user's circles |
| `geofence_event` | checkGeofenceStatus() | userId, userName, zoneName, eventType ('entry'/'exit'), timestamp | All circle members |
| `sos_alert` | POST /sos | userId, userName, userAvatar, latitude, longitude, message, timestamp | All circle members |
| `admin_broadcast` | POST /admin/broadcast | message, type ('info'/'warning'/'alert'), timestamp | ALL connected clients |

### SSE Service (services/sse.js)
- `addClient(userId, res)` — registers SSE connection
- `removeClient(userId, res)` — removes on disconnect
- `sendToCircleMembers(circleId, event, data)` — queries DB for circle members → sends to each
- `sendToAllConnected(event, data)` — broadcasts to every connected client
- `getConnectedCount()` — returns total active SSE connections

### Client-side SSE (ChildPanel)
```javascript
const evtSource = new EventSource('/api/v1/sse/stream?token=' + token)
evtSource.addEventListener('location_update', handler)
evtSource.addEventListener('geofence_event', handler)
evtSource.addEventListener('sos_alert', handler)
evtSource.onerror = () => evtSource.close()
```

---

## 12. MEDIA / FILE UPLOAD SYSTEM

### Avatar Upload Flow (3-step presigned upload)
```
Step 1: POST /api/v1/media/avatar/presign
        Body: { contentType, fileSize }
        Returns: { uploadUrl (R2 presigned), publicUrl }

Step 2: PUT {uploadUrl}
        Headers: { Content-Type: file.type }
        Body: file binary (no auth header — direct to R2)

Step 3: POST /api/v1/media/avatar/confirm
        Body: { publicUrl }
        Returns: { avatar_url }
        → Updates user.avatar_url in DB + localStorage
```

**Storage:** Cloudflare R2 (S3-compatible object storage)
**Used in:** ChildPanel Profile tab, ParentPanel Settings

---

## 13. GEOFENCE SYSTEM

### How it works
1. Parent creates a safe zone (circle on map) via ParentPanel
2. Stored in `safe_zones` table with PostGIS geometry
3. Every time a child posts location (`POST /users/location`), the backend calls `checkGeofenceStatus(userId, lat, lng)`
4. The service queries all safe zones for user's circles and checks if user is inside/outside each
5. State changes (inside → outside = "exit", outside → inside = "entry") fire:
   - `geofence_event` SSE event to all circle members
   - Log entry in `geofence_events` table

### PostGIS Query (approximate)
```sql
SELECT sz.*, ST_Distance(
  sz.geom::geography,
  ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography
) as distance_m
FROM safe_zones sz
JOIN circles c ON c.id = sz.circle_id
JOIN circle_members cm ON cm.circle_id = c.id
WHERE cm.user_id = $userId AND sz.active = TRUE
```

---

## 14. SOS ALERT SYSTEM

### Trigger Sources
1. **ChildPanel Home tab** — hold SOS button 3 seconds
2. **ChildPanel SOS tab** — hold big SOS button 3 seconds
3. **ChildPanel SOS tab** — Quick Message buttons (instant send)
4. **(Future) Expo mobile app** — background SOS trigger

### Flow
```
User holds SOS button (3s countdown)
      ↓
getCurrentPosition() → get fresh GPS
      ↓
POST /api/v1/sos { latitude, longitude, message }
      ↓
Backend:
  1. Gets all circles user belongs to
  2. SSE broadcasts 'sos_alert' to all circle members
  3. Logs to sos_events table
  4. Optionally logs GPS to device_locations
      ↓
Circle members receive SSE 'sos_alert':
  - ChildPanel: toast + alert added to Alerts tab
  - ParentPanel: alert + toast + can view location on map
  - AdminPanel: visible in SOS Events tab
```

### Cancel SOS
- Release button before 3 seconds = cancel (no API call)
- `cancelHomeSos()` / `cancelBigSos()` clears interval

---

## 15. ENVIRONMENT VARIABLES

```bash
# Backend (.env)
JWT_SECRET=<secret_key>           # JWT signing secret
ADMIN_SECRET=<admin_password>     # Admin panel password
DATABASE_URL=<postgres_url>       # PostgreSQL connection string

# SMS (optional — dev fallback to console.log)
MSG91_AUTH_KEY=<key>
MSG91_TEMPLATE_ID=<template>

# Cloudflare R2
R2_ACCOUNT_ID=<id>
R2_ACCESS_KEY_ID=<key>
R2_SECRET_ACCESS_KEY=<secret>
R2_BUCKET_NAME=<bucket>
R2_PUBLIC_URL=<cdn_url>

# Server
PORT=8002                         # Backend port
```

```bash
# Frontend (landing-react)
PORT=8090                         # Frontend server port
API_PORT=8002                     # Backend port to proxy to
```

---

## 16. SERVER SETUP

### Frontend Server (landing-react/server.cjs)
- Plain Node.js HTTP server (no Express)
- Port: **8090**
- `/api/*` → proxy to backend:8002 (with SSE streaming support)
- Static files served from `dist/`
- SPA fallback: all unknown paths → `dist/index.html`
- MIME types handled manually

### Backend Server (Express)
- Port: **8002**
- Rate limiting: 900s window / 1000 requests max
- Zod validation on all POST/PATCH routes
- PostGIS required (PostgreSQL extension)
- CORS handled by Express middleware

### Build & Run
```bash
# Frontend
cd landing-react
npm install
npm run build        # Vite build → dist/
node server.cjs      # Start on :8090

# Backend
cd backend
npm install
node src/index.js    # Start on :8002
```

---

## QUICK REFERENCE — WHAT EACH PANEL CAN DO

| Feature | Child Panel | Parent Panel | Admin Panel |
|---------|-------------|--------------|-------------|
| View own location | ✅ | — | — |
| Share GPS location | ✅ | ✅ | — |
| View family map | ✅ (read-only) | ✅ (full control) | — |
| Send SOS | ✅ | ✅ | — |
| Receive SOS | ✅ | ✅ | ✅ (logs) |
| Create geofences | ❌ | ✅ | — |
| View geofence alerts | ✅ | ✅ | ✅ (logs) |
| Create family circle | ❌ | ✅ | — |
| Join family circle | ✅ | — | — |
| Manage members | ❌ | ✅ | ✅ |
| Upload avatar | ✅ | ✅ | — |
| View location history | ✅ (own) | ✅ (members) | — |
| Ban/unban users | ❌ | ❌ | ✅ |
| Delete users | ❌ | ❌ | ✅ |
| View OTP logs | ❌ | ❌ | ✅ |
| Broadcast messages | ❌ | ❌ | ✅ |
| Purge location data | ❌ | ❌ | ✅ |
| View system stats | ❌ | ❌ | ✅ |

---

*End of GRAVITY_SYSTEM_INFO.md*
