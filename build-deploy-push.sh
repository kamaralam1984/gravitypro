#!/usr/bin/env bash
# build-deploy-push.sh — ONE command to: push code, deploy the website, and
# publish a mobile OTA live-update to already-installed apps.
#
# Usage:   ./build-deploy-push.sh "optional commit/update message"
#
# Optional: export GRAVITY_SSH="root@srv1569796" to auto-run the VPS deploy step
#           over SSH. If unset, the script prints the exact VPS commands instead.
#
# Optional: pass `--apk` (or set PUBLISH_APK=1) to ALSO build a fresh Android APK
#           and publish it to the website download page (for new installs / native
#           changes). This is the slow path — it runs an EAS cloud build.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Parse args: any `--apk` flag (anywhere) opts into the APK publish step; the
# remaining positional arg is the commit/update message.
PUBLISH_APK="${PUBLISH_APK:-0}"
MSG=""
for arg in "$@"; do
  case "$arg" in
    --apk) PUBLISH_APK=1 ;;
    *) [ -z "$MSG" ] && MSG="$arg" ;;
  esac
done
[ -z "$MSG" ] && MSG="$(git log -1 --pretty=%s 2>/dev/null || echo 'update')"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "==> Branch: ${BRANCH}"
# The live website + the GitHub OTA Action both deploy from 'shivam-repo'.
if [ "$BRANCH" != "shivam-repo" ]; then
  echo "WARNING: production deploys from 'shivam-repo', but you are on '${BRANCH}'."
  read -r -p "         Continue anyway? [y/N] " ok
  [ "$ok" = "y" ] || { echo "Aborted."; exit 1; }
fi

# 1) PUSH code to GitHub
echo "==> [1/3] Pushing code to origin/${BRANCH} ..."
git push origin "$BRANCH"

# 2) BUILD + publish mobile OTA (live-update for installed apps)
echo "==> [2/3] Publishing mobile OTA live-update ..."
bash "$ROOT/scripts/ota-update.sh" "$MSG"

# 3) DEPLOY the website on the VPS
echo "==> [3/3] Deploying website ..."
if [ -n "${GRAVITY_SSH:-}" ]; then
  ssh "$GRAVITY_SSH" 'cd /var/www/gravitypro && git pull && pm2 restart gravity-web gravity-api && pm2 save'
else
  cat <<'EOF'
    SSH not configured. Run these on the VPS to finish the website deploy:
      cd /var/www/gravitypro && git pull && pm2 restart gravity-web gravity-api && pm2 save
    (set GRAVITY_SSH="user@host" to automate this step next time)
EOF
fi

# 4) OPTIONAL: build + publish a fresh APK to the website download page.
#    (new installs / native changes). Opt in with `--apk` or PUBLISH_APK=1.
if [ "${PUBLISH_APK}" = "1" ]; then
  echo "==> [4/4] Building + publishing APK to the download page ..."
  bash "$ROOT/scripts/publish-apk.sh"
else
  echo "==> (skipping APK build — pass --apk or set PUBLISH_APK=1 for native releases)"
fi

echo "==> Done. Installed apps will live-update on next launch; website is deployed."
