# GravityPro — Features Breakdown

Family safety / location-tracking product. **100% FREE — koi paid/subscription/billing nahi.**
Do hisse hain: **Website (web app)** aur **Mobile App (React Native / Expo)**.

> Removed (June 2026): Screen Time monitoring, App Blocking/App-Lock (Play Protect stalkerware triggers), and all Subscription/Payment/Billing/Pricing. Zone-create / Safe Zones / geofence is KEPT in both website and mobile.

---

## 🌐 WEBSITE (landing-react/src) — 3 roles: Admin, Parent, Child

### Public pages
- Home landing page (marketing, animated map demo)
- Terms of Service, Privacy Policy, Share page
- (No Pricing / Checkout pages — removed)

### Auth
- Login/Register — phone + email, OTP verify, Parent/Child account type, country select

### Parent Dashboard (`/parent/panel`)
- Live map (Dark/Light/Satellite/Street), member markers, battery + last-seen, location history
- Family circle management — create/join via invite code, multi-circle switch, leave
- **Geofence / Safe zones (KEPT)** — create/edit/delete, radius, activation toggle, entry/exit alerts
- Alerts — real-time SOS, geofence events, alert history, unread badge (SSE live)
- Profile & settings — avatar upload, edit name, logout, account deletion (no plan badge)

### Child Dashboard (`/child/panel`)
- Real-time GPS sharing, location history, read-only family map
- SOS button (3-2-1 countdown) + full SOS tab
- Activity dashboard — distance today, **safe zones visited**, check-ins
- Alert history (geofence + SOS), notification settings

### Admin Panel (`/admin/panel`)
- Stats, user management/ban, circle management, SOS + geofence event logs, system + OTP/SMS monitoring
- (No subscription/payment admin endpoints — removed)

---

## 📱 MOBILE APP (mobile/) — React Native Expo 54, v1.0.3 (versionCode 5), com.trackalways.gravity

### Bottom tabs
1. **Home** — family status, avatars, battery, SOS, Mark Safe
2. **Map** — live family locations, **safe zones (KEPT)**, nearest-zone distance, SOS modal
3. **Circles** — family circles, member roster, add circle, tap child → child hub
4. **Alerts** — All / SOS / Geofence tabs, mark resolved, SSE live, pull-to-refresh
5. **Dashboard (Panel)** — WebView of web panel with SSO (auto parent/child); OTA-updatable
6. **Profile** — edit name/email, avatar upload, location history, logout (no subscription card)

### Child hub (parent → child tap)
- **Location Timeline** — stays & trips by day
- **Safe Zones (KEPT)** — create/edit/delete geofences, who's inside/outside
- ~~Screen Time~~ — REMOVED
- ~~App Blocking~~ — REMOVED

### Native capabilities
- **Background location** — Android foreground service + iOS background mode, offline queue, Traccar
- **Push notifications** — Expo Push, "Gravity Alerts" channel
- Camera/photo (avatar), battery reporting, haptics
- OTA updates (Expo Updates, channel: preview)
- ~~GravityUsage (UsageStats)~~ and ~~GravityBlocker (Accessibility)~~ native modules — REMOVED (Play Protect fix)

---

## 🔑 Website vs Mobile
| Capability | Website | Mobile |
|---|---|---|
| Map / family / circles / alerts / SOS | ✅ | ✅ |
| **Zone create / Safe Zones / geofence** | ✅ | ✅ |
| Admin panel | ✅ | ❌ |
| Background location tracking | ❌ (browser GPS) | ✅ native |
| Push notifications | ❌ | ✅ |
| Screen-time / App-lock | ❌ removed | ❌ removed |
| Subscription / paid | ❌ all free | ❌ all free |

> Panel tab mobile me website ka hi WebView hai (SSO ke saath). Sab features free.
