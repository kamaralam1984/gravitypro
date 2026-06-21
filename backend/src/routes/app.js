const express = require('express')
const router = express.Router()

// Current APK version info — update this whenever a new build is released
const APP_VERSION = {
  version: '1.0.1',
  versionCode: 2,
  downloadUrl: 'https://expo.dev/artifacts/eas/vcLkPImEPK3rzDQINNegQPWXp4_RgYuNte2jQDMnFak.apk',
  releaseNotes: 'Bug fixes: login crash resolved, maps improved',
  forceUpdate: false,
}

// GET /api/v1/app/version — public, no auth needed
router.get('/version', (req, res) => {
  res.json(APP_VERSION)
})

module.exports = router
