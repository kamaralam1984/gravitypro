import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import styles from './Checkout.module.css'

declare global {
  interface Window {
    Razorpay: new (opts: Record<string, unknown>) => { open(): void }
  }
}

interface Plan { id: string; display_name: string; price_usd: number; price_inr: number; price_kes: number; price_eur: number; price_gbp: number; features: string[] }
const CURRENCY_NAMES: Record<string, string> = { USD:'US Dollar', INR:'Indian Rupee', KES:'Kenyan Shilling', EUR:'Euro', GBP:'British Pound' }
const CURRENCY_SYMBOLS: Record<string, string> = { USD:'$', INR:'₹', KES:'KSh', EUR:'€', GBP:'£' }
const PLAN_PRICES: Record<string, Record<string, number>> = {
  family:  { USD:5.99, INR:299, KES:599, EUR:5.49, GBP:4.99 },
  premium: { USD:9.99, INR:499, KES:999, EUR:8.99, GBP:7.99 },
}
const GATEWAY_LABELS: Record<string, { label: string; icon: string; detail: string }> = {
  razorpay: { label: 'Razorpay',   icon: '🇮🇳', detail: 'UPI, Cards, Net Banking (India)' },
  mpesa:    { label: 'M-Pesa',     icon: '📱', detail: 'STK Push on your phone (Kenya/Tanzania)' },
  pesapal:  { label: 'Pesapal',    icon: '🌍', detail: 'Cards, M-Pesa, Airtel (East Africa)' },
  stripe:   { label: 'Stripe',     icon: '💳', detail: 'Credit/Debit Cards (Global)' },
  paypal:   { label: 'PayPal',     icon: '🌐', detail: '145+ countries via PayPal wallet' },
}

type Step = 'loading' | 'select' | 'mpesa-phone' | 'mpesa-waiting' | 'redirect' | 'done' | 'error'

export default function Checkout() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const planId = params.get('plan') || 'family'
  const currency = (params.get('currency') || 'USD').toUpperCase()

  const [step, setStep]             = useState<Step>('loading')
  const [plan, setPlan]             = useState<Plan | null>(null)
  const [gateways, setGateways]     = useState<string[]>([])
  const [selected, setSelected]     = useState('')
  const [phone, setPhone]           = useState('')
  const [phoneErr, setPhoneErr]     = useState('')
  const [_orderId, setOrderId]       = useState('')
  const [errMsg, setErrMsg]         = useState('')
  const [processing, setProcessing] = useState(false)
  const pollRef                     = useRef<ReturnType<typeof setInterval> | null>(null)

  const price = PLAN_PRICES[planId]?.[currency]
  const sym   = CURRENCY_SYMBOLS[currency] || '$'
  const token = localStorage.getItem('gravity_token') || sessionStorage.getItem('gravity_token') || ''

  useEffect(() => {
    // Load plan info
    fetch('/api/v1/payments/plans').then(r => r.json()).then(d => {
      const found = d.plans?.find((p: Plan) => p.id === planId)
      if (found) setPlan({ ...found, features: typeof found.features === 'string' ? JSON.parse(found.features) : (found.features || []) })
    }).catch(() => {})
    // Load gateways for this currency
    fetch('/api/v1/payments/gateways?currency=' + currency).then(r => r.json()).then(d => {
      setGateways(d.gateways || ['stripe', 'paypal'])
      setSelected(d.gateways?.[0] || 'stripe')
      setStep('select')
    }).catch(() => { setGateways(['stripe','paypal']); setSelected('stripe'); setStep('select') })
  }, [planId, currency])

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  // Load Razorpay script lazily
  function loadRazorpay(): Promise<void> {
    return new Promise((res, rej) => {
      if (window.Razorpay) return res()
      const s = document.createElement('script')
      s.src = 'https://checkout.razorpay.com/v1/checkout.js'
      s.onload = () => res(); s.onerror = () => rej(new Error('Razorpay script failed to load'))
      document.head.appendChild(s)
    })
  }

  async function createOrder(phoneNum?: string) {
    if (!token) { navigate('/login?redirect=/checkout?plan=' + planId + '&currency=' + currency); return }
    setProcessing(true); setErrMsg('')
    try {
      const body: Record<string, unknown> = { planId, gateway: selected, currency, returnUrl: window.location.href }
      if (phoneNum) body.phone = phoneNum
      const r = await fetch('/api/v1/payments/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(body),
      })
      const d = await r.json()
      if (!r.ok) { setErrMsg(d.error || 'Failed to create order'); setStep('error'); setProcessing(false); return }

      setOrderId(d.orderId)

      if (selected === 'razorpay') {
        await loadRazorpay()
        const rz = new window.Razorpay({
          key: d.clientData.key,
          amount: d.clientData.amount,
          currency,
          order_id: d.clientData.orderId,
          name: 'Gravity Family Safety',
          description: (plan?.display_name || planId) + ' Plan – Monthly',
          theme: { color: '#00E676' },
          handler: async function(response: Record<string, string>) {
            setStep('loading')
            const vr = await fetch('/api/v1/payments/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
              body: JSON.stringify({ orderId: d.orderId, gateway: 'razorpay', gatewayOrderId: response.razorpay_order_id, gatewayPaymentId: response.razorpay_payment_id, signature: response.razorpay_signature }),
            })
            const vd = await vr.json()
            if (vd.success) { setStep('done') } else { setErrMsg(vd.error || 'Payment verification failed'); setStep('error') }
          },
          modal: { ondismiss: () => { setProcessing(false) } }
        })
        rz.open()
        setProcessing(false)
      } else if (selected === 'mpesa') {
        // Poll for completion
        const cid = d.clientData?.checkoutRequestId
        startMpesaPoll(d.orderId, cid)
        setStep('mpesa-waiting')
        setProcessing(false)
      } else if (d.checkoutUrl) {
        setStep('redirect')
        setTimeout(() => { window.location.href = d.checkoutUrl }, 1200)
        setProcessing(false)
      } else {
        setErrMsg('Payment gateway error — no checkout URL returned'); setStep('error'); setProcessing(false)
      }
    } catch(e: unknown) { setErrMsg(e instanceof Error ? e.message : 'Network error'); setStep('error'); setProcessing(false) }
  }

  function startMpesaPoll(oid: string, _cid: string) {
    let tries = 0
    pollRef.current = setInterval(async () => {
      tries++
      if (tries > 30) { clearInterval(pollRef.current!); setErrMsg('M-Pesa payment timed out. Check your phone and try again.'); setStep('error'); return }
      try {
        const r = await fetch('/api/v1/payments/status/' + oid, { headers: { Authorization: 'Bearer ' + token } })
        const d = await r.json()
        if (d.status === 'completed') { clearInterval(pollRef.current!); setStep('done') }
        else if (d.status === 'failed') { clearInterval(pollRef.current!); setErrMsg('M-Pesa payment failed. Please try again.'); setStep('error') }
      } catch {}
    }, 4000)
  }

  function handlePay() {
    if (selected === 'mpesa') { setStep('mpesa-phone'); return }
    createOrder()
  }

  function handleMpesaSubmit() {
    const cleaned = phone.replace(/\s+/g, '').replace(/^0/, '254').replace(/^\+/, '')
    if (!/^254\d{9}$/.test(cleaned)) { setPhoneErr('Enter a valid Kenyan number, e.g. 0712345678'); return }
    setPhoneErr(''); createOrder(cleaned)
  }

  const displayPrice = price ? sym + price + '/month' : ''

  return (
    <div className={styles.root}>
      <nav className={styles.nav}>
        <Link to="/" className={styles.navLogo}><span>📍</span><span className={styles.logoText}>GRAVITY</span></Link>
        <Link to="/pricing" className={styles.navBack}>← Pricing</Link>
      </nav>

      <div className={styles.container}>
        {/* LEFT: Order summary */}
        <div className={styles.summary}>
          <div className={styles.summaryTag}>Order Summary</div>
          <div className={styles.summaryPlan}>{plan?.display_name || planId} Plan</div>
          <div className={styles.summaryPrice}>{displayPrice}</div>
          <div className={styles.summaryCurrency}>{CURRENCY_NAMES[currency] || currency} · billed monthly</div>

          {plan && (
            <ul className={styles.summaryFeatures}>
              {(Array.isArray(plan.features) ? plan.features : []).map((f: string) => (
                <li key={f} className={styles.summaryFeatureItem}><span className={styles.tick}>✓</span>{f}</li>
              ))}
            </ul>
          )}

          <div className={styles.guarantee}>🛡️ 7-day money-back guarantee · Cancel anytime</div>
        </div>

        {/* RIGHT: Checkout form */}
        <div className={styles.form}>
          {step === 'loading' && (
            <div className={styles.centerBox}><div className={styles.spinner} /><p>Loading payment options…</p></div>
          )}

          {step === 'select' && (
            <>
              <div className={styles.formTitle}>Choose payment method</div>
              <div className={styles.gatewayList}>
                {gateways.map(gw => {
                  const info = GATEWAY_LABELS[gw] || { label: gw, icon: '💰', detail: '' }
                  return (
                    <label key={gw} className={styles.gatewayOption + (selected === gw ? ' ' + styles.gatewaySelected : '')}>
                      <input type="radio" name="gw" value={gw} checked={selected === gw} onChange={() => setSelected(gw)} />
                      <span className={styles.gwIcon}>{info.icon}</span>
                      <span className={styles.gwInfo}>
                        <span className={styles.gwLabel}>{info.label}</span>
                        <span className={styles.gwDetail}>{info.detail}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
              <button className={styles.payBtn} onClick={handlePay} disabled={!selected || processing}>
                {processing ? <span className={styles.btnSpinner} /> : `Pay ${displayPrice}`}
              </button>
              <p className={styles.secureNote}>🔒 Secure payment · SSL encrypted · No card data stored on our servers</p>
            </>
          )}

          {step === 'mpesa-phone' && (
            <>
              <div className={styles.formTitle}>Enter M-Pesa number</div>
              <p className={styles.mpesaHint}>You will receive an STK push notification on your phone to complete payment.</p>
              <div className={styles.phoneRow}>
                <span className={styles.countryFlag}>🇰🇪 +254</span>
                <input
                  className={styles.phoneInput + (phoneErr ? ' ' + styles.inputErr : '')}
                  type="tel"
                  placeholder="7XXXXXXXX"
                  value={phone}
                  onChange={e => { setPhone(e.target.value); setPhoneErr('') }}
                  onKeyDown={e => e.key === 'Enter' && handleMpesaSubmit()}
                />
              </div>
              {phoneErr && <p className={styles.errText}>{phoneErr}</p>}
              <button className={styles.payBtn} onClick={handleMpesaSubmit} disabled={processing}>
                {processing ? <span className={styles.btnSpinner} /> : 'Send STK Push'}
              </button>
              <button className={styles.backLink} onClick={() => setStep('select')}>← Back</button>
            </>
          )}

          {step === 'mpesa-waiting' && (
            <div className={styles.centerBox}>
              <div className={styles.bigIcon}>📱</div>
              <div className={styles.waitTitle}>Check your phone</div>
              <p className={styles.waitText}>An M-Pesa payment request has been sent to your phone. Enter your PIN to complete the payment.</p>
              <div className={styles.spinner} />
              <p className={styles.waitSub}>Waiting for confirmation…</p>
            </div>
          )}

          {step === 'redirect' && (
            <div className={styles.centerBox}>
              <div className={styles.spinner} />
              <div className={styles.waitTitle}>Redirecting to payment…</div>
              <p className={styles.waitText}>You will be taken to a secure payment page. Do not close this tab.</p>
            </div>
          )}

          {step === 'done' && (
            <div className={styles.centerBox}>
              <div className={styles.successIcon}>✅</div>
              <div className={styles.successTitle}>Payment Successful!</div>
              <p className={styles.successText}>Your {plan?.display_name || planId} plan is now active. Welcome to Gravity Premium!</p>
              <button className={styles.payBtn} onClick={() => navigate('/parent/panel')}>Go to Dashboard →</button>
            </div>
          )}

          {step === 'error' && (
            <div className={styles.centerBox}>
              <div className={styles.errorIcon}>❌</div>
              <div className={styles.errorTitle}>Payment Failed</div>
              <p className={styles.errText}>{errMsg || 'Something went wrong. Please try again.'}</p>
              <button className={styles.payBtn} onClick={() => { setStep('select'); setErrMsg('') }}>Try Again</button>
              <Link to="/pricing" className={styles.backLink}>← Back to Pricing</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
