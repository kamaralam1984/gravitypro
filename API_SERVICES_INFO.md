# GravityPro — Third-Party APIs & Services (Paid vs Free + Limits)

This documents every external API/service the **website (landing-react)**, **mobile app**, and **backend** integrate with — whether it's **paid or free**, and for free ones the **monthly limit / free tier**.

> ⚠️ **Pricing & free-tier limits change often.** Numbers below are typical/approximate (2024–2025). Always confirm on each provider's current pricing page before launch. "Free integration" for payment gateways means no monthly fee — they take a **% per transaction**.

Evidence: derived from `backend/package.json` + `.env.example`, `mobile/package.json`, `landing-react/package.json`, and code references found in `backend/src`, `mobile/src`, `landing-react/src`.

---

## 💚 Cost-Optimized Stack (what we changed to save money)

GravityPro now runs a **free-first** architecture. The swaps we made:

- **Google Maps → free Leaflet + OpenStreetMap + CARTO basemaps** (and Esri ArcGIS for the satellite layer). No API key, no billing card, no monthly map bill.
- **SMS-first → Email-first OTP.** Email OTP (free SMTP tiers / dev mode) is now the **primary** verification method. SMS OTP (MSG91) is **optional and off by default**, so the main recurring paid cost is avoided.
- **Cloudflare R2 kept** for storage — generous free tier and **$0 egress**.

**Practical effect:** With this setup the app can run with **ZERO mandatory monthly API costs** — you only pay payment-gateway %-fees when collecting money, plus your own server/DB/storage as usage grows. **SMS is the only optional paid add-on** (enable MSG91 only if you want phone-OTP).

---

## 🔑 QUICK SUMMARY TABLE

| # | Service | Category | Paid / Free | Free monthly limit (approx) | Used in |
|---|---------|----------|-------------|------------------------------|---------|
| 1 | **Neon PostgreSQL** | Database | Free tier + Paid | ~0.5 GB storage, ~190 compute-hrs/mo | Backend |
| 2 | **Cloudflare R2** | File/object storage | Free tier + Paid | 10 GB storage, 1M writes, 10M reads/mo, **$0 egress** | Backend (avatars/media) |
| 3 | **Google Maps Platform** | Native maps | **REMOVED — replaced by free OSM/Leaflet/CARTO** | n/a (no longer used) | — (not used) |
| 4 | **OpenStreetMap tiles** | Map tiles | **FREE** | Fair-use policy (no bulk/high-volume) | Mobile + Web (Leaflet) |
| 5 | **CARTO basemaps** (cartocdn) | Map tiles (dark/light/voyager) | **FREE** (basemaps) | Reasonable use + attribution | Mobile FamilyMap + Web |
| 6 | **Esri ArcGIS Online tiles** | Satellite map tiles | Free (limited) + Paid | Limited tile usage; commercial needs subscription | Mobile/Web (SAT layer) |
| 7 | **MSG91** | SMS OTP | **OPTIONAL (off by default)** — PAID if enabled | No real free tier (~₹0.15–0.25/SMS) | Backend (optional phone OTP) |
| 8 | **SMTP / Email** (nodemailer) | Email OTP — **PRIMARY** | Free (provider tier) | Gmail ~500/day · SendGrid 100/day free | Backend (primary OTP) |
| 9 | **Expo Push Notifications** | Push (FCM/APNs) | **FREE** | Unlimited (per-second rate limit) | Mobile + Backend |
| 10 | **Expo EAS Update** (expo-updates) | OTA JS updates | Free tier + Paid | ~1,000 update MAU/mo free | Mobile |
| 11 | **Stripe** | Payments | Free integration | $0/mo; ~2.9% + $0.30 / txn | Backend + Web |
| 12 | **Razorpay** | Payments (India) | Free integration | $0/mo; ~2% / txn | Backend + Web |
| 13 | **PayPal** | Payments | Free integration | $0/mo; ~2.9–3.49% + fixed / txn | Backend + Web |
| 14 | **M-Pesa (Safaricom Daraja)** | Mobile money (Kenya) | Free API + txn charges | Sandbox free; live per M-Pesa tariff | Backend + Web |
| 15 | **PesaPal** | Payments (East Africa) | Free integration | ~3.5% / txn | Backend + Web |
| 16 | **Sentry** | Error monitoring | Free tier + Paid | 5,000 errors/mo, 1 user | Mobile/Backend (referenced) |
| 17 | **Google OAuth (Sign-In)** | Authentication | **FREE** | No cost | Mobile + Web + Backend |
| 18 | **Google Fonts** | Web fonts | **FREE** | Unlimited | Web |
| 19 | **Traccar** | GPS tracking server | **FREE (open-source) — optional self-host, NOT running** | Your own server (if you set it up) | Backend (webhook stub only) |
| 20 | **Redis** (BullMQ/ioredis) | Job queue / cache | Free (self) / tiered | Optional; Upstash free ~10k cmd/day | Backend (optional) |
| 21 | **unpkg CDN** (Leaflet) | JS/CSS CDN | **FREE** | Fair use | Mobile FamilyMap |
| 22 | **Lorem Picsum** (picsum.photos) | Placeholder images | **FREE** | Dev/demo only | Web/dev placeholders |

**Totals:** ~22 external services. **Google Maps is REMOVED** (replaced by free OSM/Leaflet/CARTO + Esri satellite). **Optional paid add-on: MSG91 (SMS) — off by default; email OTP is primary and free.** **Paid-per-transaction (no monthly fee): Stripe, Razorpay, PayPal, M-Pesa, PesaPal.** Everything else has a usable **free tier**, so there are **no mandatory monthly API costs**.

---

## 📋 DETAILS BY CATEGORY

### 1) Database — **Neon PostgreSQL** (`@neondatabase/serverless`, `pg`)
- **Free tier:** ~0.5 GB storage, 1 project/branch, ~190 compute-hours/month (auto-suspends when idle). Good for dev + small prod.
- **Paid:** Launch ~$19/mo (more storage/compute, no auto-suspend).
- Used by: backend (all data).

### 2) Object Storage — **Cloudflare R2** (`@aws-sdk/client-s3`)
- **Free tier:** 10 GB storage/mo, 1M Class-A (write) ops, 10M Class-B (read) ops/mo, and **no egress/bandwidth fees** (R2's big advantage).
- **Paid beyond:** $0.015/GB-month storage + op fees.
- Used by: backend avatar/circle-icon uploads (presigned URLs).

### 3) Maps — **all FREE (OpenStreetMap + Leaflet + CARTO + Esri)**
The app **and** website render maps with **Leaflet** on free tile sources — **no API key, no billing card, no monthly map bill**.
- **OpenStreetMap** tiles: **Free** under the OSM tile usage policy (no heavy/bulk usage; add attribution).
- **CARTO basemaps** (`basemaps.cartocdn.com` — dark/light/voyager): **Free** basemap tiles for reasonable use with attribution.
- **Esri ArcGIS Online** (`server.arcgisonline.com` — satellite/SAT layer): free for limited use; commercial/high-volume needs an ArcGIS subscription.
- **Google Maps Platform** — **REMOVED / not used.** The previously-required `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` and `react-native-maps` Google dependency are no longer needed. Maps now run entirely on the free Leaflet/OSM/CARTO stack above, eliminating the billing-account requirement.

### 4) SMS OTP — **MSG91** — **OPTIONAL (off by default)**
- **Disabled by default** to avoid the only meaningful recurring paid cost. Email OTP (below) is the primary verification method.
- **If you enable it:** it's **PAID — no meaningful free tier.** Pay per SMS (~₹0.15–0.25 per transactional SMS in India; varies by country/route). Small trial credits sometimes on signup.
- With no MSG91 key set (default), the backend returns `dev_otp` / relies on email OTP instead of sending SMS — so it costs ₹0.

### 5) Email OTP — **SMTP** (`nodemailer`) — **PRIMARY**
- **Now the primary OTP channel** — free via standard SMTP free tiers (and dev mode), which is why no paid SMS is required.
- Cost depends on the SMTP provider you configure:
  - **Gmail SMTP:** ~500 emails/day free (personal) — not for bulk.
  - **SendGrid:** 100 emails/day free forever.
  - **Brevo/Mailgun/SES:** various free tiers.
- If unset → backend logs/returns the OTP (dev mode), ₹0.

### 6) Push Notifications — **Expo Push** (`expo-notifications`, `EXPO_ACCESS_TOKEN`, exp.host)
- **FREE.** Unlimited notifications (rate-limited per second). Uses FCM (Android)/APNs (iOS) underneath, both free.

### 7) OTA Updates — **Expo EAS Update** (`expo-updates`)
- **Free tier:** ~1,000 monthly-active-users for OTA updates + limited bandwidth. Paid EAS plans for more.

### 8) Payment Gateways (5) — all **free to integrate, charge per transaction**
| Gateway | Region | Approx fee | Sandbox |
|---|---|---|---|
| **Stripe** | Global | ~2.9% + $0.30/txn | Free |
| **Razorpay** | India | ~2%/txn | Free |
| **PayPal** | Global | ~2.9–3.49% + fixed/txn | Free (`api-m.sandbox.paypal.com`) |
| **M-Pesa (Safaricom Daraja)** | Kenya | per M-Pesa tariff | Free (`sandbox.safaricom.co.ke`) |
| **PesaPal** | East Africa | ~3.5%/txn | Free (`cybqa.pesapal.com`) |
- **No monthly subscription** for any — you only pay the % when money is collected.

### 9) Error Monitoring — **Sentry**
- **Free tier:** 5,000 errors/month, 1 user, short retention. Paid Team plan ~$26/mo for more.

### 10) Auth — **Google OAuth / Google Sign-In**
- **FREE.** No cost for authentication / "Continue with Google".

### 11) GPS Tracking — **Traccar** — **optional self-host (NOT currently running)** (webhook `TRACCAR_WEBHOOK_SECRET`)
- **FREE / open-source** if you choose to self-host it later. Currently the backend only has a placeholder `/webhooks/traccar` stub — no Traccar server is running and no positions are ingested from it. Phone GPS is reported by the app directly. Self-host Traccar later (its own Docker/server) if you want dedicated device tracking — no managed/per-request fees, just your server cost.

### 12) Queue/Cache — **Redis** (`bullmq`, `ioredis`) — *optional*
- Backend runs in node-cron mode by default (no Redis needed). If you scale: self-host Redis (free) or managed (e.g., Upstash free ~10k commands/day).

### 13) CDNs / Misc (all FREE)
- **unpkg** — serves Leaflet JS/CSS in the FamilyMap WebView.
- **Google Fonts** — web fonts.
- **Lorem Picsum** (`picsum.photos`) — placeholder images (development/demo only; replace for production).

---

## ✅ WHAT YOU MUST PAY FOR (to run in production)
There are **no mandatory monthly API costs**. The only spend is:
1. **Payment gateway fees** — only when you actually collect money (% per transaction, no fixed cost).
2. **Hosting/DB/storage** beyond free tiers (Neon, R2, your own VPS) as usage grows.
3. **MSG91 SMS** — *optional, off by default.* Enable only if you want real phone-OTP via SMS; otherwise the free email-OTP/dev-OTP path covers verification.

> Note: **Google Maps is no longer a cost** — maps run on the free OSM/Leaflet/CARTO (+ Esri satellite) stack.

## 🆓 FULLY FREE (within limits) — everything else
Maps (OSM/CARTO/ArcGIS via Leaflet — Google Maps removed), email OTP (provider free tier, **primary**), Expo Push, Expo Updates, Google OAuth, Google Fonts, Sentry (5k/mo), Traccar (optional self-host — not running), Redis (optional), Neon (0.5 GB), Cloudflare R2 (10 GB, $0 egress), CDNs.

---

*Generated for GravityPro. Verify each provider's current pricing/limits before going live.*
