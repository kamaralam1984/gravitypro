// Pesapal — Kenya, Uganda, Tanzania, Rwanda, Zambia (Cards, M-Pesa, Airtel)
// Env: PESAPAL_CONSUMER_KEY, PESAPAL_CONSUMER_SECRET,
//      PESAPAL_ENV (sandbox|live), PESAPAL_IPN_URL, PESAPAL_IPN_ID
module.exports = {
  name: 'pesapal',
  isConfigured: !!(process.env.PESAPAL_CONSUMER_KEY && process.env.PESAPAL_CONSUMER_SECRET),
  supportedCurrencies: ['KES','UGX','TZS','RWF','ZMW','USD'],

  _base() { return process.env.PESAPAL_ENV === 'live' ? 'https://pay.pesapal.com/v3' : 'https://cybqa.pesapal.com/pesapalv3' },

  async _token() {
    const axios = require('axios')
    const r = await axios.post(this._base()+'/api/Auth/RequestToken', {
      consumer_key: process.env.PESAPAL_CONSUMER_KEY,
      consumer_secret: process.env.PESAPAL_CONSUMER_SECRET
    }, { headers: { Accept: 'application/json', 'Content-Type': 'application/json' } })
    return r.data.token
  },

  async _ipnId(token) {
    if (process.env.PESAPAL_IPN_ID) return process.env.PESAPAL_IPN_ID
    try {
      const axios = require('axios')
      const ipnUrl = process.env.PESAPAL_IPN_URL || 'https://gravitypro.kvlbusinesssolutions.com/api/v1/payments/callback/pesapal'
      const r = await axios.post(this._base()+'/api/URLSetup/RegisterIPN',
        { url: ipnUrl, ipn_notification_type: 'POST' },
        { headers: { Authorization: 'Bearer '+token, Accept: 'application/json', 'Content-Type': 'application/json' } })
      return r.data.ipn_id
    } catch(e) { return '' }
  },

  async createOrder({ orderId, planName, amount, currency, userEmail, userPhone, returnUrl }) {
    try {
      const axios = require('axios')
      const token = await this._token()
      const ipnId = await this._ipnId(token)
      const base = returnUrl || 'https://gravitypro.kvlbusinesssolutions.com/checkout'

      const r = await axios.post(this._base()+'/api/Transactions/SubmitOrderRequest', {
        id: orderId,
        currency: currency || 'KES',
        amount: parseFloat(amount),
        description: 'Gravity '+planName+' Plan',
        callback_url: base+'?status=success&order_id='+orderId+'&gateway=pesapal',
        notification_id: ipnId,
        billing_address: { email_address: userEmail || '', phone_number: userPhone || '', first_name: 'Gravity', last_name: 'Customer' }
      }, { headers: { Authorization: 'Bearer '+token, Accept: 'application/json', 'Content-Type': 'application/json' } })

      return { success: true, gatewayOrderId: r.data.order_tracking_id, checkoutUrl: r.data.redirect_url, clientData: { trackingId: r.data.order_tracking_id } }
    } catch(e) { return { success: false, error: e.response ? JSON.stringify(e.response.data) : e.message } }
  },

  async verifyPayment({ gatewayOrderId }) {
    try {
      const axios = require('axios')
      const token = await this._token()
      const r = await axios.get(this._base()+'/api/Transactions/GetTransactionStatus?orderTrackingId='+gatewayOrderId,
        { headers: { Authorization: 'Bearer '+token, Accept: 'application/json' } })
      if (r.data.payment_status_description === 'Completed') return { success: true, transactionId: r.data.confirmation_code }
      return { success: false, error: 'Pesapal status: '+r.data.payment_status_description }
    } catch(e) { return { success: false, error: e.message } }
  },

  async processWebhook(body) {
    try {
      const data = typeof body === 'string' ? JSON.parse(body) : body
      if (data.status === 'COMPLETED' || data.payment_status_description === 'Completed') {
        return { success: true, event: 'payment_success', orderId: data.merchant_reference || data.order_id, gatewayPaymentId: data.order_tracking_id }
      }
      return { success: true, event: 'ignored' }
    } catch(e) { return { success: false, error: e.message } }
  }
}
