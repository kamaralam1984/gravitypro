# Trackalways Gravity — Family Safety & Connection Platform

**Version:** 1.0.0 | **Author:** Rodney Otieno | **Date:** May 2026

---

## Project Structure

```
Gravity/
├── backend/                    # Node.js v20+ + Express 5.2.x
│   ├── migrations/
│   │   └── 001_initial.sql     # PostgreSQL + PostGIS schema
│   ├── src/
│   │   ├── app.js              # Express entry point
│   │   ├── config/
│   │   │   ├── db.js           # PostgreSQL (Neon Cloud) pool
│   │   │   └── r2.js           # Cloudflare R2 S3 client
│   │   ├── middleware/
│   │   │   ├── auth.js         # JWT authentication
│   │   │   └── validate.js     # Zod request validation
│   │   ├── routes/
│   │   │   ├── auth.js         # POST /auth/register, /auth/login
│   │   │   ├── users.js        # GET/PATCH /users/me
│   │   │   ├── circles.js      # Family circle CRUD + join
│   │   │   ├── geofences.js    # Safe zone CRUD (PostGIS)
│   │   │   ├── media.js        # R2 pre-signed URL upload
│   │   │   └── sse.js          # GET /sse/stream (real-time)
│   │   ├── services/
│   │   │   ├── geofence.js     # ST_Contains validation + entry/exit
│   │   │   └── sse.js          # In-memory SSE client registry
│   │   ├── webhooks/
│   │   │   └── traccar.js      # POST /webhooks/traccar/location
│   │   ├── jobs/
│   │   │   └── index.js        # node-cron → BullMQ cleanup jobs
│   │   └── db/
│   │       └── migrate.js      # Run SQL migration
│   ├── .env.example
│   └── package.json
│
├── mobile/                     # Expo 54 + React Native 0.81
│   ├── app/                    # Expo Router screens
│   ├── src/
│   │   ├── theme/
│   │   │   ├── colors.js       # Dark green premium palette
│   │   │   └── typography.js
│   │   ├── components/
│   │   │   ├── MemberAvatar.jsx
│   │   │   ├── PulseRing.jsx
│   │   │   ├── BatteryIndicator.jsx
│   │   │   └── ui/
│   │   │       ├── GradientCard.jsx
│   │   │       └── PremiumButton.jsx
│   │   ├── screens/
│   │   │   ├── auth/
│   │   │   │   ├── SplashScreen.jsx
│   │   │   │   ├── LoginScreen.jsx
│   │   │   │   └── RegisterScreen.jsx
│   │   │   ├── HomeScreen.jsx  # Dark map + live member tracking
│   │   │   ├── CirclesScreen.jsx
│   │   │   ├── AlertsScreen.jsx
│   │   │   └── ProfileScreen.jsx
│   │   ├── services/
│   │   │   ├── api.js          # Axios client → backend
│   │   │   ├── location.js     # SLC background tracking → Traccar
│   │   │   └── notifications.js
│   │   ├── store/
│   │   │   ├── authStore.js    # Zustand auth state
│   │   │   └── circleStore.js
│   │   ├── navigation/
│   │   │   ├── AuthNavigator.jsx
│   │   │   └── TabNavigator.jsx
│   │   └── hooks/
│   │       ├── useCircleMembers.js
│   │       └── useGeofences.js
│   ├── app.json
│   └── package.json
│
└── caddy/
    └── Caddyfile               # TLS + reverse proxy + SSE buffering
```

---

## Technology Stack

| Layer | Technology |
|---|---|
| Edge Routing & Proxy | **Caddy Server** (auto TLS, SSE `flush_interval -1`) |
| Mobile Client | **Expo 54** + **React Native 0.81** |
| Telemetry Ingestion | **Traccar Middleware** (HTTP OsmAnd protocol) |
| Application Backend | **Node.js v20+** + **Express 5.2.x** |
| Database | **PostgreSQL (Neon Cloud)** + **PostGIS** |
| Object Storage | **Cloudflare R2** (pre-signed PUT URLs) |
| Real-time | **Server-Sent Events (SSE)** — no WebSockets |
| Background Jobs | **node-cron** → **BullMQ** (when `REDIS_URL` set) |

---

## Data Flows

### Location Flow
```
React Native (SLC background task)
  → HTTPS → Caddy (/telemetry/* proxy)
  → Traccar :8082 (telemetry ingestion)
  → Webhook → Express POST /webhooks/traccar/location
  → PostGIS ST_Contains (geofence validation)
  → SSE push to circle members + Expo push notifications
```

### Media Flow
```
React Native (avatar / circle icon)
  → Express POST /media/*/presign (generates pre-signed URL)
  → Direct PUT → Cloudflare R2
  → Express POST /media/*/confirm
  → PostgreSQL (stores public URL in users.avatar_url / circles.icon_url)
```

---

## Setup

### Backend
```bash
cd backend
cp .env.example .env
# Fill in DATABASE_URL, JWT_SECRET, R2_*, EXPO_ACCESS_TOKEN
npm install
npm run migrate   # runs PostGIS schema
npm start
```

### Mobile
```bash
cd mobile
npm install
npx expo start
```

### Caddy
```bash
caddy run --config caddy/Caddyfile
```

---

## Countries Supported
Kenya (KE) · India (IN) · UAE (AE) · UK (GB) · USA (US)

---

## Document Compliance
See [VALIDATION.md](./VALIDATION.md) for full compliance report.
**Status: 14/14 requirements met** (BullMQ + SLC APIs fixed post-validation)
