# Trackalways Gravity — Website Features Report
**Date:** 2026-06-18  
**Files Checked:** index.html, parent.html, child.html, parent-panel.html, child-panel.html  
**Server:** http://localhost:8090

---

## 1. index.html — Main Landing Page
**URL:** http://localhost:8090/index.html

### ✅ Kaam kar rahe features:

#### Navigation
- Logo click → hero section pe scroll
- Nav links: Features, How It Works, Countries, Testimonials, Download
- Hamburger menu (mobile pe)
- Parent Panel button → parent-panel.html
- Child Panel button → child-panel.html
- Smooth scroll sab links pe

#### Hero Section
- Animated particle canvas background (dots fly around)
- "Get Started" → download section scroll
- "See How It Works" → how section scroll
- Phone frame mockup dikh raha hai

#### Live Family Map (Leaflet.js)
- Dark CartoDB map load hota hai
- 4 family member markers (custom photo avatars)
- Home marker alag color se
- Animated dashed connection lines (dashFlow animation)
- fitBounds — sab members auto fit
- **Map Type Switcher:**
  - 🌙 Dark (CartoDB Dark Matter)
  - ☀️ Light (CartoDB Light)
  - 🛰️ Satellite (ESRI World Imagery)
  - 🗺️ Street (CartoDB Voyager)
- Zoom In / Zoom Out buttons
- Marker click → sidebar me member info
- Sidebar: member name, status, battery, distance

#### Stats Counter
- IntersectionObserver se trigger hota hai
- Numbers count up: 50K+ families, 5 countries, 99.9% uptime, 4.8 rating
- Scroll karo toh animate hota hai

#### Features Section (6 cards)
- Real-Time Tracking, Smart Geofencing, SOS Alert, Battery Monitor, Drive Safe, Privacy First
- Scroll pe reveal animation (IntersectionObserver)

#### How It Works (3 steps)
- Step cards scroll pe animate hote hain
- Create Circle, Add Members, Stay Connected

#### Countries Section
- 5 country cards: Pakistan, India, UAE, UK, USA
- Visual flag emoji with description

#### Testimonials (3)
- Static testimonial cards with star ratings

#### Download Section
- App Store button (placeholder)
- Google Play button (placeholder)
- QR code image

#### Footer
- Links: Privacy, Terms, Contact
- Social icons

---

## 2. parent.html — Parent Marketing Page
**URL:** http://localhost:8090/parent.html

### ✅ Kaam kar rahe features:
- Animated particle canvas (floating dots)
- Scroll-triggered counter animation
- Feature cards with reveal animation
- Pricing section (3 plans: Free, Family, Premium)
- Testimonials
- FAQ accordion (click to expand/collapse)
- Nav hamburger menu (mobile)
- "Open Parent Panel" → parent-panel.html link
- Footer links

### ⚠️ Buttons jo sirf UI hain (koi action nahi):
- "Download for Android/iOS" — placeholder links
- "Get Started" plan buttons — placeholder

---

## 3. child.html — Child Marketing Page
**URL:** http://localhost:8090/child.html

### ✅ Kaam kar rahe features:
- Animated particle canvas (floating dots)
- Scroll-triggered reveal animations
- Feature showcase (SOS, Location Share, Family Map)
- How it works steps
- Safety tips section
- "Open Child Panel" → child-panel.html link
- Nav hamburger menu
- Footer

### ⚠️ Placeholder:
- App download buttons — no real link

---

## 4. parent-panel.html — Parent Dashboard (Mobile App UI)
**URL:** http://localhost:8090/parent-panel.html

### ✅ Kaam kar rahe features:

#### Navigation
- 5 bottom tabs: Map, Family, Alerts, Geofence, Settings
- Tab switching smooth animation
- Notification badge (alerts tab pe "3" badge)
- Header notification bell → alerts tab pe jump

#### Tab 1: MAP
- Leaflet.js map full load
- 4 family member markers (custom photo avatars with color rings)
- Animated dashed connection lines
- fitBounds auto-fit
- **Map Type Switcher:** Dark / Light / Satellite / Street
- Custom Zoom In / Zoom Out
- Family strip (bottom scroll bar) — member click → map center
- Member card click → map focus karta hai

#### Tab 2: FAMILY
- Family member list (4 members: Ammi, Rahul, Pinky, Dada)
- Har member: photo, name, status, battery %, distance, last seen
- Visual battery bar (green/yellow/red)
- 📞 Call button → toast: "Calling [name]..."
- 💬 Message button → toast: "Message sent to [name]"
- Click member → Map tab pe location show

#### Tab 3: ALERTS
- 3 alert types: SOS, Geofence breach, Low battery
- "View Location" button → Map tab pe member location
- "Dismiss" button → alert card fade out aur remove
- Alert badge count update hoti hai dismiss pe

#### Tab 4: GEOFENCE
- 3 predefined zones: Home, School, Park
- Toggle ON/OFF checkbox
- Zone radius info
- "+ Add Zone" button → toast notification
- Card click → Add Zone
- Status badge (Active/Inactive)

#### Tab 5: SETTINGS
- Profile section (name, email, phone)
- Location Precision: Exact / Approx segment toggle
- Notification toggle switches (ON/OFF click)
- SOS Settings row
- Privacy row
- Help & Support row
- "Leave Circle" → confirm dialog
- "Delete Account" → confirm dialog

#### Toast System
- All actions pe toast notifications
- Types: success (green), error (red), call (blue), msg (purple)
- 3 seconds auto dismiss

---

## 5. child-panel.html — Child Dashboard (Mobile App UI)
**URL:** http://localhost:8090/child-panel.html

### ✅ Kaam kar rahe features:

#### Navigation
- 5 bottom tabs: Home, Map, SOS, Family, Profile
- Tab switching with animation

#### Tab 1: HOME
- Greeting card (time-based: Good morning/afternoon/evening)
- Real-time clock update (every second)
- Location card (current address)
- Status card: "Location sharing ON"
- Quick Action cards:
  - ✅ "I'm Safe" → toast + green flash
  - 📍 "Share Location" → toast
  - 🏠 "Arrived Safe" → toast
  - 💬 "Send Message" → toast
- Family strip (scroll) — member click → toast with status

#### Tab 2: MAP
- Leaflet.js map load
- Family member markers
- My location marker (alag color)
- fitBounds auto-fit
- **Map Type Switcher:** Dark / Light / Satellite / Street
- Zoom In / Zoom Out
- Family cards below map (distance + battery bar)
- Card click → map center on member

#### Tab 3: SOS (Emergency)
- Big red SOS button (center)
- **Hold 3 seconds to activate** (countdown: 3→2→1→SENT)
- mousedown/touchstart pe countdown start
- mouseup/touchend pe cancel
- Activate hone pe: screen red flash, toast, button text "SOS SENT"
- 5 second baad reset
- Quick Messages (4 buttons):
  - 🆘 "I need help!" → toast
  - ⚠️ "I'm in danger" → toast
  - 📞 "Call me now" → toast
  - 🚗 "Come pick me up" → toast
- Emergency Contacts (3): Mom, Dad, 112
  - Call button → toast "Calling [name]..."

#### Tab 4: FAMILY
- Family member cards (3: Papa, Ammi, Didi)
- Photo, name, status, battery bar, distance
- Click card → Map tab pe location show
- Click "Me" card → toast

#### Tab 5: PROFILE
- Avatar + name + "Child" badge
- Edit button → toast
- Settings toggles:
  - Location Sharing ON/OFF
  - Notifications ON/OFF
  - Location Precision: Exact/Approximate
  - SOS Sound ON/OFF
  - Family can see battery ON/OFF
- Edit Profile button → toast

---

## Summary Table

| Feature | index | parent | child | parent-panel | child-panel |
|---------|-------|--------|-------|--------------|-------------|
| Navigation / Tabs | ✅ | ✅ | ✅ | ✅ | ✅ |
| Leaflet Map | ✅ | ❌ | ❌ | ✅ | ✅ |
| Map Type Switcher | ✅ | ❌ | ❌ | ✅ | ✅ |
| Family Members | ✅ | ❌ | ❌ | ✅ | ✅ |
| Toast Notifications | ❌ | ❌ | ❌ | ✅ | ✅ |
| SOS Button (Hold) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Alert Dismiss | ❌ | ❌ | ❌ | ✅ | ❌ |
| Geofence Toggle | ❌ | ❌ | ❌ | ✅ | ❌ |
| Settings Toggles | ❌ | ❌ | ❌ | ✅ | ✅ |
| Call/Message Buttons | ❌ | ❌ | ❌ | ✅ | ✅ |
| Stats Counter | ✅ | ✅ | ❌ | ❌ | ❌ |
| Scroll Animations | ✅ | ✅ | ✅ | ✅ | ✅ |
| Particle Canvas | ✅ | ✅ | ✅ | ❌ | ❌ |
| Battery Visual Bar | ❌ | ❌ | ❌ | ✅ | ✅ |
| Real-time Clock | ❌ | ❌ | ❌ | ❌ | ✅ |
| Quick Actions | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## Jo Kaam NAHI Kar Raha (Backend Required)

| Feature | Status |
|---------|--------|
| Actual Login / Register | ❌ No backend connected |
| Real GPS location | ❌ Demo data (hardcoded) |
| Real SOS send | ❌ UI only |
| Push notifications | ❌ No server |
| App Store / Play Store links | ❌ Placeholder |
| Real geofence alerts | ❌ Demo only |
| Profile save | ❌ No backend |

---

**Total JS Functions:** ~60+ across all files  
**Total Lines of Code:** 9,141 lines  
**Maps:** Leaflet.js v1.9.4 with CartoDB + ESRI tiles  
**Design System:** Dark green (#050C08 bg, #00E676 accent)
