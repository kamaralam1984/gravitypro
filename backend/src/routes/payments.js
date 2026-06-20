const router = require('express').Router()
const express = require('express')
const { query } = require('../config/db')
const { authenticate } = require('../middleware/auth')
const { v4: uuidv4 } = require('uuid')
const jwt = require('jsonwebtoken')

const PLANS = {
  free:    { id:'free',    name:'Free Forever', price:{ USD:0,    INR:0,   KES:0,   EUR:0,    GBP:0    }, max_members:4,  max_circles:1,  history_days:1  },
  family:  { id:'family',  name:'Family',       price:{ USD:5.99, INR:299, KES:599, EUR:5.49, GBP:4.99 }, max_members:6,  max_circles:3,  history_days:7  },
  premium: { id:'premium', name:'Premium',      price:{ USD:9.99, INR:499, KES:999, EUR:8.99, GBP:7.99 }, max_members:15, max_circles:10, history_days:30 },
}

let svc = null
function getSvc() {
  if (!svc) { try { svc = require('../services/payments/index') } catch(e) { svc = null } }
  return svc
}

// GET /api/v1/payments/plans
router.get('/plans', async (req, res) => {
  try {
    const r = await query('SELECT * FROM subscription_plans WHERE is_active=TRUE ORDER BY price_usd ASC').catch(() => ({ rows: [] }))
    res.json({ plans: r.rows.length ? r.rows : Object.values(PLANS) })
  } catch(e) { res.json({ plans: Object.values(PLANS) }) }
})

// GET /api/v1/payments/gateways?currency=INR
router.get('/gateways', (req, res) => {
  const currency = (req.query.currency || 'USD').toUpperCase()
  const service = getSvc()
  if (!service) {
    // Fallback when packages not yet installed
    const fallback = { INR:['razorpay'], KES:['mpesa','pesapal'], UGX:['pesapal'], TZS:['mpesa','pesapal'] }
    const names = fallback[currency] || ['stripe','paypal']
    return res.json({ currency, gateways: names })
  }
  const gws = service.getAvailableGateways(currency)
  res.json({ currency, gateways: gws.length ? gws.map(g => g.name) : ['stripe','paypal'] })
})

// POST /api/v1/payments/create-order
router.post('/create-order', authenticate, async (req, res) => {
  try {
    const { planId, gateway, currency, returnUrl } = req.body
    if (!planId || !gateway) return res.status(400).json({ error: 'planId and gateway required' })
    const plan = PLANS[planId]
    if (!plan) return res.status(400).json({ error: 'Invalid plan: '+planId })
    if (planId === 'free') return res.status(400).json({ error: 'Free plan requires no payment' })

    const cur = (currency || 'USD').toUpperCase()
    const planPrice = plan.price[cur]
    if (planPrice === undefined || planPrice === 0) return res.status(400).json({ error: 'Currency '+cur+' not supported for this plan' })

    // Amount in smallest unit (paise for INR, cents for USD/EUR/GBP; whole units for KES)
    const amountSmallest = ['KES','TZS','UGX','RWF','ZMW'].includes(cur) ? planPrice : Math.round(planPrice * 100)

    const orderId = uuidv4()
    await query('INSERT INTO payment_orders (id,user_id,plan_id,gateway,amount,currency,status) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [orderId, req.user.id, planId, gateway, planPrice, cur, 'pending']).catch(() => {})

    const service = getSvc()
    if (!service) return res.status(503).json({ error: 'Payment services not ready. Run: npm install razorpay stripe axios in /backend' })
    const gw = service.getGateway(gateway)
    if (!gw) return res.status(400).json({ error: 'Unknown gateway: '+gateway })
    if (!gw.isConfigured) return res.status(503).json({ error: gateway+' credentials not configured. Add to .env and restart.' })

    const APP_URL = process.env.APP_URL || 'https://gravitypro.kvlbusinesssolutions.com'
    const result = await gw.createOrder({
      orderId, planId, planName: plan.name,
      amount: amountSmallest, currency: cur,
      userId: req.user.id, userEmail: req.user.email || '', userPhone: req.user.phone || '',
      callbackUrl: APP_URL+'/api/v1/payments/callback/'+gateway,
      returnUrl: returnUrl || APP_URL+'/checkout',
    })

    if (!result.success) return res.status(500).json({ error: result.error || 'Gateway error' })
    await query('UPDATE payment_orders SET gateway_order_id=$1 WHERE id=$2', [result.gatewayOrderId, orderId]).catch(() => {})
    res.json({ success: true, orderId, gatewayOrderId: result.gatewayOrderId, checkoutUrl: result.checkoutUrl, clientData: result.clientData })
  } catch(e) { console.error('create-order:', e); res.status(500).json({ error: e.message }) }
})

// POST /api/v1/payments/verify
router.post('/verify', authenticate, async (req, res) => {
  try {
    const { orderId, gateway, gatewayOrderId, gatewayPaymentId, signature } = req.body
    if (!orderId || !gateway) return res.status(400).json({ error: 'orderId and gateway required' })

    const ord = await query('SELECT * FROM payment_orders WHERE id=$1 AND user_id=$2', [orderId, req.user.id])
    if (!ord.rows.length) return res.status(404).json({ error: 'Order not found' })
    if (ord.rows[0].status === 'completed') return res.json({ success: true, already: true, plan: ord.rows[0].plan_id })

    const service = getSvc()
    const gw = service && service.getGateway(gateway)
    if (!gw) return res.status(400).json({ error: 'Unknown gateway' })

    const result = await gw.verifyPayment({ orderId, gatewayOrderId, gatewayPaymentId, signature })
    if (!result.success) {
      await query("UPDATE payment_orders SET status='failed' WHERE id=$1", [orderId]).catch(() => {})
      return res.status(400).json({ error: result.error || 'Verification failed' })
    }

    await activateSub(req.user.id, ord.rows[0].plan_id, gateway, result.transactionId || gatewayPaymentId, orderId)
    res.json({ success: true, plan: ord.rows[0].plan_id })
  } catch(e) { console.error('verify:', e); res.status(500).json({ error: e.message }) }
})

// GET /api/v1/payments/status/:orderId — poll for M-Pesa result
router.get('/status/:orderId', authenticate, async (req, res) => {
  try {
    const r = await query('SELECT status,plan_id,gateway FROM payment_orders WHERE id=$1 AND user_id=$2', [req.params.orderId, req.user.id])
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found' })
    res.json(r.rows[0])
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── Webhooks (raw body for signature verification) ──
router.post('/webhook/razorpay', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const gw = getSvc() && getSvc().getGateway('razorpay')
    if (!gw) return res.sendStatus(200)
    const r = await gw.processWebhook(req.body, req.headers)
    if (r.success && r.event === 'payment_success' && r.orderId) {
      const ord = await query('SELECT * FROM payment_orders WHERE id=$1', [r.orderId])
      if (ord.rows.length && ord.rows[0].status === 'pending')
        await activateSub(ord.rows[0].user_id, ord.rows[0].plan_id, 'razorpay', r.gatewayPaymentId, r.orderId)
    }
    res.sendStatus(200)
  } catch(e) { console.error('razorpay webhook:', e); res.sendStatus(200) }
})

router.post('/webhook/stripe', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const gw = getSvc() && getSvc().getGateway('stripe')
    if (!gw) return res.sendStatus(200)
    const r = await gw.processWebhook(req.body, req.headers)
    if (r.success && r.event === 'payment_success' && r.orderId) {
      const ord = await query('SELECT * FROM payment_orders WHERE id=$1', [r.orderId])
      if (ord.rows.length && ord.rows[0].status === 'pending')
        await activateSub(ord.rows[0].user_id, ord.rows[0].plan_id, 'stripe', r.gatewayPaymentId, r.orderId)
    }
    res.sendStatus(200)
  } catch(e) { console.error('stripe webhook:', e); res.sendStatus(200) }
})

router.post('/webhook/paypal', async (req, res) => {
  try {
    const gw = getSvc() && getSvc().getGateway('paypal')
    if (!gw) return res.sendStatus(200)
    const r = await gw.processWebhook(req.body, req.headers)
    if (r.success && r.event === 'payment_success' && r.orderId) {
      const ord = await query('SELECT * FROM payment_orders WHERE id=$1', [r.orderId])
      if (ord.rows.length && ord.rows[0].status === 'pending')
        await activateSub(ord.rows[0].user_id, ord.rows[0].plan_id, 'paypal', r.gatewayPaymentId, r.orderId)
    }
    res.sendStatus(200)
  } catch(e) { console.error('paypal webhook:', e); res.sendStatus(200) }
})

router.post('/callback/mpesa', async (req, res) => {
  try {
    const gw = getSvc() && getSvc().getGateway('mpesa')
    if (!gw) return res.json({ ResultCode: 0 })
    const r = await gw.processWebhook(req.body, req.headers)
    if (r.success && r.event === 'payment_success' && r.orderId) {
      // r.orderId is CheckoutRequestID — look up by gateway_order_id
      const ord = await query('SELECT * FROM payment_orders WHERE gateway_order_id=$1', [r.orderId])
      if (ord.rows.length && ord.rows[0].status === 'pending')
        await activateSub(ord.rows[0].user_id, ord.rows[0].plan_id, 'mpesa', r.gatewayPaymentId, ord.rows[0].id)
    }
    res.json({ ResultCode: 0, ResultDesc: 'Success' })
  } catch(e) { console.error('mpesa callback:', e); res.json({ ResultCode: 0 }) }
})

router.post('/callback/pesapal', async (req, res) => {
  try {
    const gw = getSvc() && getSvc().getGateway('pesapal')
    if (!gw) return res.sendStatus(200)
    const r = await gw.processWebhook(req.body, req.headers)
    if (r.success && r.event === 'payment_success' && r.orderId) {
      const ord = await query('SELECT * FROM payment_orders WHERE id=$1', [r.orderId])
      if (ord.rows.length && ord.rows[0].status === 'pending')
        await activateSub(ord.rows[0].user_id, ord.rows[0].plan_id, 'pesapal', r.gatewayPaymentId, r.orderId)
    }
    res.sendStatus(200)
  } catch(e) { console.error('pesapal callback:', e); res.sendStatus(200) }
})

// POST /api/v1/payments/create-order-anon
// Creates a payment order without a logged-in user — used during signup flow before account creation.
router.post('/create-order-anon', async (req, res) => {
  try {
    const { phone_token, plan: planId, gateway, currency, name, email } = req.body
    if (!phone_token) return res.status(400).json({ error: 'phone_token required' })
    if (!planId || !gateway) return res.status(400).json({ error: 'plan and gateway required' })

    // Verify phone_token JWT
    let decoded
    try {
      decoded = jwt.verify(phone_token, process.env.JWT_SECRET)
    } catch(e) {
      return res.status(401).json({ error: 'Invalid or expired phone_token' })
    }
    if (decoded.type !== 'phone_verified') return res.status(401).json({ error: 'phone_token must be of type phone_verified' })
    const phone = decoded.phone || decoded.phoneNumber || ''

    const plan = PLANS[planId]
    if (!plan) return res.status(400).json({ error: 'Invalid plan: ' + planId })
    if (planId === 'free') return res.status(400).json({ error: 'Free plan requires no payment' })

    const cur = (currency || 'USD').toUpperCase()
    const planPrice = plan.price[cur]
    if (planPrice === undefined || planPrice === 0) return res.status(400).json({ error: 'Currency ' + cur + ' not supported for this plan' })

    // Amount in smallest unit (paise for INR, cents for USD/EUR/GBP; whole units for KES etc.)
    const amountSmallest = ['KES', 'TZS', 'UGX', 'RWF', 'ZMW'].includes(cur) ? planPrice : Math.round(planPrice * 100)

    const orderId = uuidv4()
    const metadata = { name: name || '', email: email || '', phone }
    await query(
      'INSERT INTO payment_orders (id,user_id,plan_id,gateway,amount,currency,status,phone,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [orderId, null, planId, gateway, planPrice, cur, 'pending', phone, JSON.stringify(metadata)]
    ).catch(() => {})

    const service = getSvc()
    if (!service) return res.status(503).json({ error: 'Payment services not ready. Run: npm install razorpay stripe axios in /backend' })
    const gw = service.getGateway(gateway)
    if (!gw) return res.status(400).json({ error: 'Unknown gateway: ' + gateway })
    if (!gw.isConfigured) return res.status(503).json({ error: gateway + ' credentials not configured. Add to .env and restart.' })

    const APP_URL = process.env.APP_URL || 'https://gravitypro.kvlbusinesssolutions.com'
    const result = await gw.createOrder({
      orderId, planId, planName: plan.name,
      amount: amountSmallest, currency: cur,
      userId: null, userEmail: email || '', userPhone: phone,
      callbackUrl: APP_URL + '/api/v1/payments/callback/' + gateway,
      returnUrl: APP_URL + '/checkout',
    })

    if (!result.success) return res.status(500).json({ error: result.error || 'Gateway error' })
    await query('UPDATE payment_orders SET gateway_order_id=$1 WHERE id=$2', [result.gatewayOrderId, orderId]).catch(() => {})
    res.json({ success: true, orderId, gatewayOrderId: result.gatewayOrderId, checkoutUrl: result.checkoutUrl, clientData: result.clientData })
  } catch(e) { console.error('create-order-anon:', e); res.status(500).json({ error: e.message }) }
})

// ── Helper: activate subscription ──
async function activateSub(userId, planId, gateway, gatewayPaymentId, orderId) {
  const now = new Date()
  const end = new Date(now); end.setMonth(end.getMonth() + 1)
  await query("UPDATE payment_orders SET status='completed', gateway_payment_id=$1, updated_at=NOW() WHERE id=$2", [gatewayPaymentId, orderId]).catch(() => {})
  try {
    await query("UPDATE user_subscriptions SET status='cancelled', cancelled_at=NOW() WHERE user_id=$1 AND status='active'", [userId])
    await query('INSERT INTO user_subscriptions (user_id,plan_id,status,gateway,current_period_start,current_period_end) VALUES ($1,$2,$3,$4,$5,$6)',
      [userId, planId, 'active', gateway, now, end])
    await query('UPDATE users SET current_plan=$1 WHERE id=$2', [planId, userId])
  } catch(e) { console.error('activateSub:', e) }
}

module.exports = router
