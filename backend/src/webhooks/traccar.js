const router = require('express').Router()

// Traccar position webhook (placeholder). If you self-host Traccar later, wire
// this to map a Traccar device -> GravityPro user and ingest positions into the
// location pipeline. Currently a no-op that just acknowledges receipt.
router.post('/', (req, res) => res.json({ success: true }))

module.exports = router
