// Stripe — USA, UK, Europe, India, Global (Cards, Apple Pay, Google Pay)
// Env: STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET
let stripeInstance = null
function getStripe() {
  if (!stripeInstance) {
    const Stripe = require('stripe')
    stripeInstance = Stripe(process.env.STRIPE_SECRET_KEY)
  }
  return stripeInstance
}

module.exports = {
  name: 'stripe',
  isConfigured: !!(process.env.STRIPE_SECRET_KEY),
  supportedCurrencies: ['USD','EUR','GBP','INR','AED','SGD','AUD','CAD','MYR','NZD'],

  async createOrder({ orderId, planName, amount, currency, userEmail, returnUrl }) {
    try {
      const stripe = getStripe()
      const base = returnUrl || 'https://gravitypro.kvlbusinesssolutions.com/checkout'
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: currency.toLowerCase(),
            product_data: { name: 'Gravity '+planName+' Plan', description: 'Monthly subscription — cancel anytime' },
            unit_amount: Math.round(amount),
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: base+'?status=success&session_id={CHECKOUT_SESSION_ID}&order_id='+orderId,
        cancel_url: base+'?status=cancelled&order_id='+orderId,
        metadata: { orderId, planName },
        customer_email: userEmail || undefined,
      })
      return { success: true, gatewayOrderId: session.id, checkoutUrl: session.url, clientData: { sessionId: session.id, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY } }
    } catch(e) { return { success: false, error: e.message } }
  },

  async verifyPayment({ gatewayOrderId }) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(gatewayOrderId)
      if (session.payment_status === 'paid') return { success: true, transactionId: session.payment_intent }
      return { success: false, error: 'Payment status: '+session.payment_status }
    } catch(e) { return { success: false, error: e.message } }
  },

  async processWebhook(rawBody, headers) {
    try {
      const stripe = getStripe()
      let event
      try {
        event = stripe.webhooks.constructEvent(rawBody, headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)
      } catch(e) { return { success: false, error: 'Webhook sig failed: '+e.message } }

      if (event.type === 'checkout.session.completed') {
        const s = event.data.object
        if (s.payment_status === 'paid') {
          return { success: true, event: 'payment_success', orderId: s.metadata && s.metadata.orderId, gatewayPaymentId: s.payment_intent, amount: s.amount_total / 100, currency: s.currency.toUpperCase() }
        }
      }
      if (event.type === 'checkout.session.expired') {
        return { success: true, event: 'payment_failed', orderId: event.data.object.metadata && event.data.object.metadata.orderId }
      }
      return { success: true, event: 'ignored' }
    } catch(e) { return { success: false, error: e.message } }
  }
}
