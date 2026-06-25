# Live Update (OTA) — how website/app changes reach installed apps

This sets up **automatic live updates** so changes reach users without a Play Store / App Store update.

## Two-track auto-update

GravityPro keeps users current through **two independent tracks**:

**(a) OTA — for already-installed apps (JS/UI changes).**
A push that touches `mobile/**` runs `eas update --channel production`
(`.github/workflows/ota-update.yml`, or `./scripts/ota-update.sh`). Installed
apps live-update on next launch — **no reinstall, no store release**. This
covers the React Native screens (Map, Circles, Alerts, Profile, parental
screens) but **not** native modules/SDK changes.

**(b) Download page — for NEW installs / native changes.**
The site always serves the latest APK at
<https://gravitypro.kvlbusinesssolutions.com/downloads/GravityPro.apk> (linked
from the `/#download` section; served by `landing-react/server.cjs` from a
`downloads/` dir, deployed on the VPS at
`/var/www/gravitypro/landing-react/downloads/GravityPro.apk`). Each **native
release** rebuilds the APK (EAS `preview` profile) and refreshes that file, via:

- `./scripts/publish-apk.sh` (local), or
- `build-deploy-push.sh --apk` (or `PUBLISH_APK=1 ./build-deploy-push.sh`), or
- the **APK Release** GitHub Action (`.github/workflows/apk-release.yml`),
  triggered manually or by a push to `shivam-repo` with `[apk]` in the commit
  message.

**Which track for which change?**

| Change | Track |
|---|---|
| JS / UI on a native screen | (a) OTA — auto on `mobile/**` push |
| Backend / API / data | neither — fetched live |
| New native module, permission, SDK, or version bump | (b) rebuild APK **and** publish a fresh OTA |
| Brand-new install | (b) download page |

> **Expo account:** the Expo `projectId` now lives under the **`gravitypro`**
> account. `EXPO_TOKEN` must be a token for that account (used by both the OTA
> and APK Release workflows and the local scripts). A new `projectId` is written
> into `mobile/app.json` when the teammate runs `eas init`.

> **Version-freeze caveat (see below):** OTA only reaches installs whose app
> version matches `mobile/app.json → expo.version`. After a native release that
> bumps the version, publish a fresh OTA so the new version line is covered too,
> and refresh the download-page APK so new installs get the latest build.

### First-time seed (one manual VPS step)

The download page needs a `GravityPro.apk` to exist before automation overwrites
it. After the first EAS APK build, copy it onto the VPS once:

```bash
scp GravityPro.apk USER@HOST:/var/www/gravitypro/landing-react/downloads/GravityPro.apk
```

(or download the `GravityPro-apk` artifact from the APK Release workflow run and
copy that). Subsequent native releases overwrite it automatically.

## What auto-updates (and what does not)

| You change… | Reaches installed app automatically? | How |
|---|---|---|
| **Website** "Panel" tab content (the embedded web dashboard) | ✅ Yes, instantly | App's WebView loads the live site |
| **Backend / API / data** (login, alerts, SOS, prices) | ✅ Yes, instantly | Native screens fetch the API |
| **Mobile native UI** (Map, Circles, Alerts, Profile, parental screens) | ⚠️ Only after an **OTA push** | `eas update` → app live-updates on next launch |
| **Native modules / SDK** (new native library, permissions) | ❌ No | Needs a new **store build** + user update |

> ~80–85% of the app is native React Native. Those screens do **not** change when
> you edit the website — they need an OTA push. That is what the tooling below automates.

## One-time setup

1. **Authenticate EAS** (owner: `gravitynew`, project `aacddc46-fdbb-45a7-9f01-2dd951ffcaa5`):
   - Locally: `eas login`
   - Or create a token at <https://expo.dev/settings/access-tokens> and `export EXPO_TOKEN=...`
2. **GitHub Action secret** (for push-triggered OTA): in the GitHub repo →
   Settings → Secrets and variables → Actions → add `EXPO_TOKEN`.
3. **Put the workflow on the deployed branch.** The Action only runs on `shivam-repo`
   (the branch the site deploys from). Ensure `.github/workflows/ota-update.yml` exists
   **on `shivam-repo`** (currently created on `master`; cherry-pick/merge it over).

## Usage

### Manual — one command (local script)
```bash
./build-deploy-push.sh "what changed"
```
Pushes code → publishes OTA → deploys website (set `GRAVITY_SSH="user@host"` to auto-run
the VPS step; otherwise it prints the commands).

OTA only:
```bash
./scripts/ota-update.sh "what changed"
```

### Automatic — GitHub Action
Any push to **`shivam-repo`** that touches `mobile/**` publishes an OTA update to the
`production` channel. No manual step.

## ⚠️ The version-freeze rule (critical)

`runtimeVersion` policy is `appVersion`, so an OTA update **only reaches installs whose
app version equals `mobile/app.json` → `expo.version`** (currently **`1.0.3`**).

- **Do NOT bump `version`** if you want OTA to keep reaching existing users.
- Bump `version` **only** when you ship a new native store build; after that, publish a
  fresh OTA so the new version line is covered too.
