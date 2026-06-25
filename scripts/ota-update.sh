#!/usr/bin/env bash
# ota-update.sh — publish an Expo OTA update so ALREADY-INSTALLED apps live-update
# (no Play Store / App Store update needed).
#
# IMPORTANT: An OTA update only reaches installed builds whose app version matches
# mobile/app.json -> expo.version (runtimeVersion policy is "appVersion").
# If you bump the version for a new native store build, OTA updates published
# afterwards will NOT reach the older installs. Keep the version frozen between
# native releases so OTA keeps flowing to existing users.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE="$(cd "$HERE/../mobile" && pwd)"
cd "$MOBILE"

MSG="${1:-$(git log -1 --pretty=%s 2>/dev/null || echo 'ota update')}"

# --- Auth guard (EXPO_TOKEN env var OR an interactive `eas login`) ---
if [ -z "${EXPO_TOKEN:-}" ]; then
  if ! npx --yes eas-cli whoami >/dev/null 2>&1; then
    echo "ERROR: Not authenticated with EAS." >&2
    echo "  Fix one of:" >&2
    echo "    - run:    eas login" >&2
    echo "    - or set: export EXPO_TOKEN=<token from https://expo.dev/settings/access-tokens>" >&2
    exit 1
  fi
fi

VER="$(node -p "require('./app.json').expo.version")"
echo "==> Publishing OTA  | channel: production | app version: ${VER} | msg: ${MSG}"
echo "    (reaches only installed production builds with version ${VER})"
npx --yes eas-cli update --channel production --message "${MSG}" --non-interactive
echo "==> OTA published. Installed v${VER} apps will live-update on next launch."
