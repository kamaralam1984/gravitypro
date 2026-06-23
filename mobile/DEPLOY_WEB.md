# GravityPro Mobile — Web build deploy guide

Built: Expo web export (SPA) → `mobile/dist/` (6.4 MB, 37 files).
API baked in: `https://gravitypro.kvlbusinesssolutions.com` (live backend). No env needed at runtime.

## What changed in source
- `app.json`: added `"web"` to `platforms` + a `web` block (`bundler: metro`, `output: single`, favicon).
  This is required for `expo export --platform web`.

## Rebuild command (if you change code)
```bash
cd mobile
EXPO_PUBLIC_API_URL=https://gravitypro.kvlbusinesssolutions.com npx expo export --platform web
# output -> mobile/dist/
```

## How to deploy (you do this on the live server, 187.127.148.237)

The `dist/` is a static SPA. index.html references assets with **absolute** paths
(`/_expo/...`, `/assets/...`). The existing live site (landing-react/Vite) ALSO uses
`/assets/` — so do NOT drop this at the domain root or under a subpath on the same
host, the `/assets/` paths will collide.

### Recommended: a dedicated subdomain (e.g. app.gravitypro.kvlbusinesssolutions.com)
1. Add a DNS A record `app.gravitypro` → 187.127.148.237 (same GoDaddy panel).
2. Copy the build: `scp -r mobile/dist/* server:/var/www/gravity-app/`
3. nginx vhost:
```nginx
server {
    server_name app.gravitypro.kvlbusinesssolutions.com;
    root /var/www/gravity-app;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }   # SPA fallback
}
```
4. `sudo nginx -t && sudo systemctl reload nginx` + issue TLS (`certbot --nginx -d app.gravitypro.kvlbusinesssolutions.com`).

### Alternative: a subpath like /app on the existing domain
Asset absolute paths break under a subpath. Rebuild with a base URL first:
```bash
cd mobile
EXPO_PUBLIC_API_URL=https://gravitypro.kvlbusinesssolutions.com \
  npx expo export --platform web   # then set "baseUrl":"/app" under expo.experiments in app.json before building
```
Then serve `dist/` at `location /app/ { try_files $uri $uri/ /app/index.html; }`.
Tell me if you want this variant and I'll rebuild it.

## IMPORTANT web-compatibility caveats (test before announcing)
This is a React-Native app run through react-native-web. Native-only pieces degrade on web:
- **FamilyMap / Map tab**: uses `react-native-webview` → **no web support**; the in-app
  Leaflet map will likely not render. (The landing site's own Leaflet map is separate and fine.)
- **expo-location / background location**: web has limited/no support — live tracking won't work like native.
- **expo-notifications, expo-secure-store, battery**: fall back to web shims or no-op;
  auth token persists via localStorage (OTP login works, verified against live API).
- Camera/avatar upload, OTA updates: native-only.

→ Login, circles, profile, alerts (REST data) will work in browser. Map + live location will not.
For a full-fidelity mobile experience, an APK/AAB (EAS build) is the right path — ask if you want that.
