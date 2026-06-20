// Razorpay payment service — India (INR)
// Required env: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET

const crypto = require('crypto')

let razorpayInstance = null
function getRazorpay() {
  if (!razorpayInstance) {
    const Razorpay = require('razorpay')
    razorpayInstance = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  }
  return razorpayInstance
}

const service = {
  name: 'razorpay',
  isConfigured: !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
  supportedCurrencies: ['INR'],

  async createOrder({ orderId, planName, amount, currency, userEmail, userPhone }) {
    try {
      const rz = getRazorpay()
      const order = await rz.orders.create({
        amount: Math.round(amount), // amount in paise
        currency: currency || 'INR',
        receipt: orderId,
        notes: { planName, orderId }
      })
      return {
        success: true,
        gatewayOrderId: order.id,
        checkoutUrl: null, // Razorpay uses JS SDK checkout, not redirect
        clientData: {
          key: process.env.RAZORPAY_KEY_ID,
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
          name: 'Gravity Family Safety',
          description: planName + ' Plan — Monthly',
          prefill: { email: userEmail, contact: userPhone },
          theme: { color: '#00C853' }
        }
      }
    } catch(e) {
      return { success: false, error: e.message }
    }
  },

  async verifyPayment({ gatewayOrderId, gatewayPaymentId, signature }) {
    try {
      const body = gatewayOrderId + '|' + gatewayPaymentId
      const expectedSig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(body).digest('hex')
      if (expectedSig !== signature) return { success: false, error: 'Invalid signature' }
      return { success: true, transactionId: gatewayPaymentId }
    } catch(e) {
      return { success: false, error: e.message }
    }
  },

  async processWebhook(rawBody, headers) {
    try {
      const sig = headers['x-razorpay-signature']
      const secret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET
      const expectedSig = crypto.createHmac('sha256', secret)
        .update(rawBody).digest('hex')
      if (sig !== expectedSig) return { success: false, error: 'Invalid webhook signature' }

      const event = JSON.parse(rawBody.toString())
      if (event.event === 'payment.captured' || event.event === 'payment.authorized') {
        const payment = event.payload.payment.entity
        const orderId = payment.notes && payment.notes.orderId
        return { success: true, event: 'payment_success', orderId, gatewayPaymentId: payment.id, amount: payment.amount / 100, currency: payment.currency }
      }
      if (event.event === 'payment.failed') {
        const payment = event.payload.payment.entity
        const orderId = payment.notes && payment.notes.orderId
        return { success: true, event: 'payment_failed', orderId, gatewayPaymentId: payment.id }
      }
      return { success: true, event: 'ignored' }
    } catch(e) {
      return { success: false, error: e.message }
    }
  }
}

module.exports = service
