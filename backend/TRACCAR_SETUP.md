# Hardware GPS Tracker / Smart-Watch Integration (Traccar)

GravityPro can ingest positions from external hardware — GPS trackers, kids'
smart-watches, vehicle trackers — by sitting downstream of a **Traccar** server.
The hardware talks Traccar's protocol; Traccar *forwards* each position to a
GravityPro webhook; GravityPro maps the device to a user and stores the position
through the **same** `device_locations` + geofence pipeline as the phone app.

```
[GPS tracker / watch]  --(GPS protocol)-->  [Traccar server]  --(HTTP forward)-->  [GravityPro webhook]
                                                                                          |
                                                          tracker_devices.device_uid -> users.id
                                                                                          |
                                                            device_locations + geofence check + SSE
```

> **The GravityPro side is now fully wired and ready.** Self-hosting / operating
> the Traccar server is **infrastructure the operator sets up** — it is not part
> of the GravityPro app. The steps below describe that one-time infra setup.

---

## 1. Self-host a Traccar server (operator infra)

Traccar is open-source (Apache-2.0). Quickest path is Docker:

```bash
docker run -d --name traccar \
  -p 8082:8082 \        # web UI / REST API
  -p 5000-5150:5000-5150 \  # device protocol ports (one per device type)
  -p 5000-5150:5000-5150/udp \
  -v /opt/traccar/logs:/opt/traccar/logs \
  -v /opt/traccar/data:/opt/traccar/data \
  traccar/traccar:latest
```

- Open the web UI at `http://<host>:8082`, create an admin account.
- Add your device: **Devices → +**, set a **Identifier** = the device's IMEI /
  unique id. This identifier is the value GravityPro stores as `device_uid`.
- Configure the physical tracker to report to `<traccar-host>:<protocol-port>`
  (port depends on the device protocol — see Traccar's device list).
- Confirm positions appear on the Traccar map before continuing.

## 2. Forward positions to GravityPro

GravityPro exposes an **unauthenticated** position webhook:

```
POST <API_BASE>/webhooks/traccar
Content-Type: application/json
```

`<API_BASE>` is the GravityPro backend origin (e.g.
`https://gravitypro.kvlbusinesssolutions.com`). The route is mounted at
`/webhooks/traccar` (it is **not** under `/api/v1`).

Configure Traccar to forward to it (pick whichever your Traccar version supports):

- **Position forwarding** — set in `conf/traccar.xml`:
  ```xml
  <entry key='forward.enable'>true</entry>
  <entry key='forward.url'>https://<API_BASE>/webhooks/traccar</entry>
  <entry key='forward.json'>true</entry>
  ```
  This forwards **every** position as JSON.

- **Event/notification forward** — Settings → Notifications → add a
  *Web (Forward)* channel with the same URL, if you only want event-driven sends.

Traccar's forwarded JSON looks like:

```json
{
  "position": {
    "latitude": 12.9716, "longitude": 77.5946,
    "speed": 0.0, "course": 90, "altitude": 50, "accuracy": 5,
    "deviceTime": "2026-06-24T10:00:00.000+00:00",
    "attributes": { "batteryLevel": 88 }
  },
  "device": { "id": 7, "uniqueId": "356938035643809", "name": "Kids Watch" }
}
```

The webhook is defensive about shape — it also accepts a flat object with
`uniqueId`/`lat`/`lon`/`course`/`battery`/`timestamp`. Positions for a
**device_uid that is not paired are acknowledged (200) and dropped.**

### Securing the webhook

`device_uid` (IMEI) is effectively the shared secret. For production also:
- restrict `/webhooks/traccar` to the Traccar host IP at nginx, and/or
- put a secret token in the forward path (operator-side reverse-proxy rewrite).

## 3. Pair the device inside GravityPro

A logged-in user calls the devices API (or uses the in-app "Pair a device" UI):

```
POST <API_BASE>/api/v1/devices
Authorization: Bearer <jwt>
{ "device_uid": "356938035643809", "name": "Kids Watch", "type": "watch" }
```

- Omit `user_id` → pairs to the caller.
- Include `"user_id": "<child-uuid>"` to pair to a child the caller created, or
  to a member of a circle where the caller is an `admin`.

From then on, every forwarded position for that IMEI is stored as that user's
location, appears on the family map in real time (SSE), and triggers safe-zone
entry/exit events exactly like the phone.

---

## API reference (`/api/v1/devices`, all authenticated)

| Method | Path           | Body / Params                                   | Result |
|--------|----------------|-------------------------------------------------|--------|
| POST   | `/devices`     | `{ device_uid, name?, type?, user_id? }`        | `201 { device }`, `409` if already paired, `403` if not allowed to pair for `user_id` |
| GET    | `/devices`     | —                                               | `200 { devices: [...] }` — yours + your circle members' |
| DELETE | `/devices/:id` | —                                               | `200 { success }`, `404`/`403` |

## Database

Migration `015_devices.sql` adds:

```sql
CREATE TABLE IF NOT EXISTS tracker_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_uid text UNIQUE NOT NULL,
  name text,
  type text DEFAULT 'gps',
  created_at timestamptz DEFAULT now()
);
```

Run with the existing migration runner: `node src/db/migrate.js`.
