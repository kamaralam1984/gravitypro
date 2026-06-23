#!/usr/bin/env bash
# publish-apk.sh — build a fresh Android APK with EAS and publish it to the
# website download page so NEW installs / native changes are picked up.
#
# The website serves the latest APK at:
#   https://gravitypro.kvlbusinesssolutions.com/downloads/GravityPro.apk
# (served by landing-react/server.cjs from a downloads/ dir; the deployed file
#  on the VPS is /var/www/gravitypro/landing-react/downloads/GravityPro.apk)
#
# Use this for NATIVE releases (new native modules, permissions, version bump).
# For JS/UI-only changes prefer the OTA path (scripts/ota-update.sh) — no
# reinstall needed.
#
# Usage:   ./scripts/publish-apk.sh
#
# Auth:    EXPO_TOKEN env var (gravitypro Expo account) OR an interactive
#          `eas login`. EXPO_TOKEN is preferred for CI.
# Optional: export GRAVITY_SSH="user@host" to scp the APK to the VPS download
#           dir automatically. If unset the script prints the manual copy step.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE="$(cd "$HERE/../mobile" && pwd)"

REMOTE_PATH="/var/www/gravitypro/landing-react/downloads/GravityPro.apk"
PUBLIC_URL="https://gravitypro.kvlbusinesssolutions.com/downloads/GravityPro.apk"

cd "$MOBILE"

# --- Auth guard (EXPO_TOKEN env var OR an interactive `eas login`) ---
if [ -z "${EXPO_TOKEN:-}" ]; then
  if ! npx --yes eas-cli whoami >/dev/null 2>&1; then
    echo "ERROR: Not authenticated with EAS (gravitypro account)." >&2
    echo "  Fix one of:" >&2
    echo "    - run:    eas login" >&2
    echo "    - or set: export EXPO_TOKEN=<token from https://expo.dev/settings/access-tokens>" >&2
    exit 1
  fi
fi

# --- Tooling guards ---
command -v node >/dev/null 2>&1 || { echo "ERROR: node not found on PATH." >&2; exit 1; }

VER="$(node -p "require('./app.json').expo.version" 2>/dev/null || echo '?')"
echo "==> Building Android APK | profile: preview | app version: ${VER}"
echo "    (eas build --platform android --profile preview --wait)"

# 1) Build the APK and wait for it to finish.
npx --yes eas-cli build --platform android --profile preview --non-interactive --wait

# 2) Resolve the artifact URL of the most recent finished APK build.
echo "==> Resolving APK artifact URL ..."
BUILD_JSON="$(npx --yes eas-cli build:list --platform android --profile preview --limit 1 --json --non-interactive)"
APK_URL="$(node -e '
  let raw = "";
  process.stdin.on("data", d => raw += d);
  process.stdin.on("end", () => {
    try {
      const arr = JSON.parse(raw);
      const b = Array.isArray(arr) ? arr[0] : arr;
      const url = b && (b.artifacts && (b.artifacts.applicationArchiveUrl || b.artifacts.buildUrl) || b.applicationArchiveUrl);
      if (!url) { process.exit(2); }
      process.stdout.write(url);
    } catch (e) { process.exit(3); }
  });
' <<<"$BUILD_JSON")" || true

if [ -z "${APK_URL:-}" ]; then
  echo "ERROR: Could not parse the APK artifact URL from eas build:list output." >&2
  echo "       Check the build at https://expo.dev and copy the .apk URL manually." >&2
  exit 1
fi
echo "    Artifact: ${APK_URL}"

# 3) Download the APK to a temp file.
TMP_APK="$(mktemp -t GravityPro-XXXXXX.apk)"
trap 'rm -f "$TMP_APK"' EXIT
echo "==> Downloading APK to ${TMP_APK} ..."
if command -v curl >/dev/null 2>&1; then
  curl -fL --retry 3 -o "$TMP_APK" "$APK_URL"
elif command -v wget >/dev/null 2>&1; then
  wget -O "$TMP_APK" "$APK_URL"
else
  echo "ERROR: neither curl nor wget is available to download the APK." >&2
  exit 1
fi
[ -s "$TMP_APK" ] || { echo "ERROR: downloaded APK is empty." >&2; exit 1; }
echo "    Downloaded $(du -h "$TMP_APK" | cut -f1) APK."

# 4) Publish to the website downloads dir as GravityPro.apk.
if [ -n "${GRAVITY_SSH:-}" ]; then
  echo "==> Uploading to ${GRAVITY_SSH}:${REMOTE_PATH} ..."
  ssh "$GRAVITY_SSH" "mkdir -p \"$(dirname "$REMOTE_PATH")\""
  scp "$TMP_APK" "${GRAVITY_SSH}:${REMOTE_PATH}"
  echo "==> Uploaded. Live at: ${PUBLIC_URL}"
else
  cat <<EOF
==> GRAVITY_SSH not set — APK NOT uploaded automatically.
    The freshly built APK is saved locally at:
      ${TMP_APK}
    To publish it, copy it onto the VPS as GravityPro.apk:
      scp "${TMP_APK}" user@host:${REMOTE_PATH}
    (or set GRAVITY_SSH="user@host" and re-run to automate this).
    Note: this temp file is deleted when the script exits — copy it now.
EOF
  # Keep the temp file around when we can't upload it, so the user can copy it.
  trap - EXIT
fi

echo "==> Done. New installs / native updates available at:"
echo "    ${PUBLIC_URL}"
