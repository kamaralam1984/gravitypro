const express = require('express')
const router = express.Router()

// Current APK version info — update this whenever a new build is released
const APP_VERSION = {
  version: '1.0.3',
  versionCode: 4,
  downloadUrl: 'https://expo.dev/artifacts/eas/UIYnXU5eMlptxTddCSStwM1OPJue5tovOMGFRl1vljU.apk',
  releaseNotes: 'Fix: circles loading, invite code, child location on map, SOS alerts, SSE connection',
  forceUpdate: false,
}

// GET /api/v1/app/version — public, no auth needed
router.get('/version', (req, res) => {
  res.json(APP_VERSION)
})

module.exports = router
