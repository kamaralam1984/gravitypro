// M-Pesa — Kenya & Tanzania (Safaricom Daraja STK Push)
// Env: MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE,
//      MPESA_PASSKEY, MPESA_CALLBACK_URL, MPESA_ENV (sandbox|production)
module.exports = {
  name: 'mpesa',
  isConfigured: !!(process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_SECRET && process.env.MPESA_SHORTCODE),
  supportedCurrencies: ['KES','TZS'],

  _base() { return process.env.MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke' },

  async _token() {
    const axios = require('axios')
    const creds = Buffer.from(process.env.MPESA_CONSUMER_KEY+':'+process.env.MPESA_CONSUMER_SECRET).toString('base64')
    const r = await axios.get(this._base()+'/oauth/v1/generate?grant_type=client_credentials',
      { headers: { Authorization: 'Basic '+creds } })
    return r.data.access_token
  },

  _ts() { return new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14) },

  _pwd(ts) {
    const passkey = process.env.MPESA_PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919'
    return Buffer.from(process.env.MPESA_SHORTCODE + passkey + ts).toString('base64')
  },

  async createOrder({ orderId, amount, userPhone, callbackUrl }) {
    try {
      const axios = require('axios')
      const token = await this._token()
      const ts = this._ts()
      const phone = (userPhone || '').replace(/[^0-9]/g,'').replace(/^0/, '254').replace(/^\+/, '')
      const amt = Math.ceil(amount) // M-Pesa needs whole KES

      const r = await axios.post(this._base()+'/mpesa/stkpush/v1/processrequest', {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: this._pwd(ts),
        Timestamp: ts,
        TransactionType: 'CustomerPayBillOnline',
        Amount: amt,
        PartyA: phone,
        PartyB: process.env.MPESA_SHORTCODE,
        PhoneNumber: phone,
        CallBackURL: process.env.MPESA_CALLBACK_URL || callbackUrl,
        AccountReference: orderId.slice(0,12),
        TransactionDesc: 'Gravity Subscription'
      }, { headers: { Authorization: 'Bearer '+token } })

      return {
        success: true,
        gatewayOrderId: r.data.CheckoutRequestID,
        checkoutUrl: null,
        clientData: {
          checkoutRequestId: r.data.CheckoutRequestID,
          merchantRequestId: r.data.MerchantRequestID,
          customerMessage: r.data.CustomerMessage || 'Enter M-Pesa PIN on your phone to complete payment.',
          method: 'stk_push'
        }
      }
    } catch(e) { return { success: false, error: e.response ? JSON.stringify(e.response.data) : e.message } }
  },

  async verifyPayment() {
    return { success: false, error: 'M-Pesa payments are verified via STK callback. Poll /api/v1/payments/status/:orderId' }
  },

  async processWebhook(body) {
    try {
      const data = typeof body === 'string' ? JSON.parse(body) : body
      const stk = data.Body && data.Body.stkCallback
      if (!stk) return { success: false, error: 'Invalid M-Pesa callback' }
      if (stk.ResultCode === 0) {
        const items = (stk.CallbackMetadata && stk.CallbackMetadata.Item) || []
        const get = (n) => { const i = items.find(x => x.Name === n); return i ? i.Value : null }
        return { success: true, event: 'payment_success', orderId: stk.CheckoutRequestID, gatewayPaymentId: get('MpesaReceiptNumber'), amount: get('Amount'), currency: 'KES' }
      }
      return { success: true, event: 'payment_failed', orderId: stk.CheckoutRequestID, error: stk.ResultDesc }
    } catch(e) { return { success: false, error: e.message } }
  }
}
