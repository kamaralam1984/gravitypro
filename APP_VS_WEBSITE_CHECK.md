# GravityPro — Mobile App vs Website Feature Check

**Date:** 2026-06-22
**Tested on:** Android emulator (Pixel_7), release APK `com.trackalways.gravity`
**Backend:** https://gravitypro.kvlbusinesssolutions.com (VPS srv1569796, Mumbai — confirmed live)
**Test login:** +91 93869 94688

---

## 1. Login result
- The number **+91 93869 94688 was NOT registered** → login returned *"No account found. Please register first."*
- Completed the 4-step **registration wizard** instead (phone OTP → email code → profile):
  - Name: Test User · Email: test9386@example.com · Account type: **Parent** · Country: India
  - Phone OTP and email code were **auto-filled by backend dev mode** (700237 / 704102 / 246135) → confirms the app reaches the live backend.
- **Account created and logged in successfully.** Landed on Home dashboard as "Test".

## 2. Live tab-by-tab walkthrough (all 6 tabs)
| Tab | Status | What it shows |
|-----|--------|---------------|
| **Home** | ✅ works | Greeting, Today's Activity (Distance / Safe Zones / Check-ins), Family Map preview, **Send SOS** button |
| **Map** | ❌ **BROKEN** | "Map Unavailable — **Google Maps API key not configured**". Header, 0/0 online, locate + SOS FABs present, but no map renders |
| **Circles** | ✅ works | "My Circles", create/join group, create-circle FAB |
| **Alerts** | ✅ works | Filters All / SOS / Geofence, real-time feed ("No alerts yet") |
| **Dashboard** | ✅ works | = **embedded Parent Panel**. PARENT badge, **live OSM map of India renders**, Family Members, Location Overview, History, notification bell, logout |
| **Profile** | ✅ works | Avatar upload, edit name/email/phone, Account Type, Location Tracking + Push toggles, **Location History**, **Check for Update** (OTA), **Sign Out**, **Delete Account** |

> Note: Map tab uses **Google Maps** (needs API key → broken). Dashboard uses **Leaflet/OSM** (works). So live tracking IS available via Dashboard.

## 3. Website features PRESENT in the app
Login/OTP/Register · Family live map (via Dashboard) · Circles (create/join/manage) · Safe Zones/Geofences · SOS + I'm Safe · Alerts feed · Check-ins · Battery/location reporting · Location history · **Parent dashboard** (Dashboard tab) · Profile edit · Avatar upload · Push notifications · Account deletion · OTA update.

## 4. Website features MISSING from the app (web-only)
1. **Payments** — no Pricing, Checkout, or payment gateways (Stripe/Razorpay/PayPal/M-Pesa/PesaPal)
2. **Subscription management UI** (plans enforced server-side, no in-app screen)
3. **Admin Panel** — user management, broadcast messages, OTP management, payment monitoring, system stats
4. **Legal pages** — Terms / Privacy
5. **Referral / Share** page
6. **Google OAuth** sign-in (backend supports it; not wired in app UI)
7. **Child-specific portal** (app has a single end-user experience; web has separate Parent/Child panels)

## 5. Bugs / action items
- 🔴 **Map tab is non-functional** — add a Google Maps API key to the app config/build, OR switch the native Map tab to the same OSM/Leaflet renderer the Dashboard tab uses.
- 🟡 Decide whether billing/subscription and legal pages should be reachable from the app (currently web-only) — app-store policy may require in-app access to Terms/Privacy and account/subscription management.

**Verdict:** All **core family-safety functions** of the website are present in the app, and the **Parent dashboard is embedded** (Dashboard tab). What's missing is **billing/subscriptions, the admin panel, legal & referral pages, and Google login** — these remain web-only. The one real defect is the **broken native Map tab (missing Google Maps API key)**.
