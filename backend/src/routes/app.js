const express = require('express')
const router = express.Router()

// Current APK version info — update this whenever a new build is released
const APP_VERSION = {
  version: '1.0.3',
  versionCode: 5,
  downloadUrl: 'https://expo.dev/artifacts/eas/Lnv8Sw55lFvaeQG3I0R-AEUcJsQRcB8TlycARsx8biQ.apk',
  releaseNotes: 'Fix: child panel restrictions, charging indicator, parental controls guard, auto OTA updates',
  forceUpdate: true,
}

// GET /api/v1/app/version — public, no auth needed
router.get('/version', (req, res) => {
  res.json(APP_VERSION)
})

module.exports = router
