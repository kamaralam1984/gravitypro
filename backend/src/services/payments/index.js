// Payment gateway router — selects correct gateway by currency/country
const razorpay = require('./razorpay')
const stripe   = require('./stripe')
const paypal   = require('./paypal')
const mpesa    = require('./mpesa')
const pesapal  = require('./pesapal')

const GATEWAYS = { razorpay, stripe, paypal, mpesa, pesapal }

// Priority order by currency
const CURRENCY_PRIORITY = {
  INR: ['razorpay','stripe','paypal'],
  KES: ['mpesa','pesapal','stripe','paypal'],
  UGX: ['pesapal','stripe','paypal'],
  TZS: ['mpesa','pesapal','stripe','paypal'],
  RWF: ['pesapal','stripe','paypal'],
  ZMW: ['pesapal','stripe','paypal'],
  USD: ['stripe','paypal'],
  EUR: ['stripe','paypal'],
  GBP: ['stripe','paypal'],
  AUD: ['stripe','paypal'],
  CAD: ['stripe','paypal'],
  AED: ['stripe','paypal'],
  SGD: ['stripe','paypal'],
  MYR: ['stripe','paypal'],
}

// Country → currency mapping (for frontend auto-detect)
const COUNTRY_CURRENCY = {
  IN:'INR', KE:'KES', UG:'UGX', TZ:'TZS', RW:'RWF', ZM:'ZMW',
  US:'USD', CA:'USD', AU:'AUD', NZ:'NZD',
  GB:'GBP', IE:'EUR', FR:'EUR', DE:'EUR', ES:'EUR', IT:'EUR',
  NL:'EUR', PT:'EUR', BE:'EUR', AT:'EUR', FI:'EUR', GR:'EUR',
  AE:'AED', SA:'SAR', QA:'QAR',
  SG:'SGD', MY:'MYR',
}

function getGateway(name) { return GATEWAYS[name] || null }

function getAvailableGateways(currency) {
  const cur = (currency || 'USD').toUpperCase()
  const names = CURRENCY_PRIORITY[cur] || CURRENCY_PRIORITY.USD
  return names
    .filter(n => GATEWAYS[n] && GATEWAYS[n].isConfigured)
    .map(n => ({ name: n, label: GATEWAYS[n].name, supportedCurrencies: GATEWAYS[n].supportedCurrencies }))
}

module.exports = { getGateway, getAvailableGateways, GATEWAYS, CURRENCY_PRIORITY, COUNTRY_CURRENCY }
