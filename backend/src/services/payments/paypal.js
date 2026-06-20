// PayPal — International (145+ countries)
// Env: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE (sandbox|live)
module.exports = {
  name: 'paypal',
  isConfigured: !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
  supportedCurrencies: ['USD','EUR','GBP','AUD','CAD','SGD','MYR','BRL','MXN','CHF','SEK','NOK','DKK','JPY','HKD'],

  _base() { return process.env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com' },

  async _token() {
    const axios = require('axios')
    const r = await axios.post(this._base()+'/v1/oauth2/token', 'grant_type=client_credentials', {
      auth: { username: process.env.PAYPAL_CLIENT_ID, password: process.env.PAYPAL_CLIENT_SECRET },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
    return r.data.access_token
  },

  async createOrder({ orderId, planName, amount, currency, userEmail, returnUrl }) {
    try {
      const axios = require('axios')
      const token = await this._token()
      const base = returnUrl || 'https://gravitypro.kvlbusinesssolutions.com/checkout'
      const r = await axios.post(this._base()+'/v2/checkout/orders', {
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: orderId,
          description: 'Gravity '+planName+' Plan — Monthly',
          amount: { currency_code: currency || 'USD', value: (amount/100).toFixed(2) }
        }],
        application_context: {
          return_url: base+'?status=success&order_id='+orderId+'&gateway=paypal',
          cancel_url: base+'?status=cancelled&order_id='+orderId,
          brand_name: 'Gravity Family Safety',
          landing_page: 'BILLING',
          user_action: 'PAY_NOW'
        }
      }, { headers: { Authorization: 'Bearer '+token, 'Content-Type': 'application/json' } })
      const link = r.data.links.find(l => l.rel === 'approve')
      return { success: true, gatewayOrderId: r.data.id, checkoutUrl: link ? link.href : null, clientData: { paypalOrderId: r.data.id } }
    } catch(e) { return { success: false, error: e.response ? JSON.stringify(e.response.data) : e.message } }
  },

  async verifyPayment({ gatewayOrderId }) {
    try {
      const axios = require('axios')
      const token = await this._token()
      const r = await axios.post(this._base()+'/v2/checkout/orders/'+gatewayOrderId+'/capture', {},
        { headers: { Authorization: 'Bearer '+token, 'Content-Type': 'application/json' } })
      if (r.data.status === 'COMPLETED') {
        const cap = r.data.purchase_units[0].payments.captures[0]
        return { success: true, transactionId: cap.id }
      }
      return { success: false, error: 'PayPal status: '+r.data.status }
    } catch(e) { return { success: false, error: e.response ? JSON.stringify(e.response.data) : e.message } }
  },

  async processWebhook(body) {
    try {
      const ev = typeof body === 'string' ? JSON.parse(body) : body
      if (ev.event_type === 'CHECKOUT.ORDER.APPROVED' || ev.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
        const pu = ev.resource && ev.resource.purchase_units && ev.resource.purchase_units[0]
        return { success: true, event: 'payment_success', orderId: pu && pu.reference_id, gatewayPaymentId: ev.resource && ev.resource.id }
      }
      return { success: true, event: 'ignored' }
    } catch(e) { return { success: false, error: e.message } }
  }
}
