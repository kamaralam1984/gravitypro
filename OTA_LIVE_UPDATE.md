# Live Update (OTA) — how website/app changes reach installed apps

This sets up **automatic live updates** so changes reach users without a Play Store / App Store update.

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
