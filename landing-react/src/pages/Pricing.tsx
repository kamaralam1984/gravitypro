import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import styles from './Pricing.module.css'

const CURRENCY_MAP: Record<string, { code: string; symbol: string; key: string }> = {
  IN: { code:'INR', symbol:'₹',   key:'price_inr' },
  KE: { code:'KES', symbol:'KSh', key:'price_kes' },
  UG: { code:'KES', symbol:'KSh', key:'price_kes' },
  TZ: { code:'KES', symbol:'KSh', key:'price_kes' },
  GB: { code:'GBP', symbol:'£',   key:'price_gbp' },
  IE: { code:'EUR', symbol:'€',   key:'price_eur' },
  FR: { code:'EUR', symbol:'€',   key:'price_eur' },
  DE: { code:'EUR', symbol:'€',   key:'price_eur' },
  ES: { code:'EUR', symbol:'€',   key:'price_eur' },
  IT: { code:'EUR', symbol:'€',   key:'price_eur' },
  NL: { code:'EUR', symbol:'€',   key:'price_eur' },
  PT: { code:'EUR', symbol:'€',   key:'price_eur' },
}
const DEFAULT_CURRENCY = { code:'USD', symbol:'$', key:'price_usd' }

interface Plan {
  id: string
  display_name: string
  price_usd: number; price_inr: number; price_kes: number; price_eur: number; price_gbp: number
  max_members: number; max_circles: number; history_days: number
  features: string[]
}

const FALLBACK_PLANS: Plan[] = [
  { id:'free',    display_name:'Free Forever', price_usd:0,    price_inr:0,   price_kes:0,   price_eur:0,    price_gbp:0,    max_members:4,  max_circles:1,  history_days:1,  features:['Live location sharing','Family Circle (up to 4 members)','1 Safe Zone / Geofence','SOS Panic Button','24-hour location history'] },
  { id:'family',  display_name:'Family',       price_usd:5.99, price_inr:299, price_kes:599, price_eur:5.49, price_gbp:4.99, max_members:6,  max_circles:3,  history_days:7,  features:['Everything in Free','Up to 6 members','3 Safe Zones','7-day location history','Battery level reports','Journey tracking'] },
  { id:'premium', display_name:'Premium',      price_usd:9.99, price_inr:499, price_kes:999, price_eur:8.99, price_gbp:7.99, max_members:15, max_circles:10, history_days:30, features:['Everything in Family','Up to 15 members','Unlimited Safe Zones','30-day history','Priority support 24/7','Auto emergency alerts'] },
]

const PLAN_ICONS = ['🆓','👨‍👩‍👧‍👦','⭐']
const PLAN_COLORS = ['#5E8B6E','#00C853','#00E676']

function detectCountry() {
  const lang = navigator.language || 'en-US'
  return (lang.split('-')[1] || 'US').toUpperCase()
}

export default function Pricing() {
  const navigate = useNavigate()
  const [plans, setPlans] = useState<Plan[]>(FALLBACK_PLANS)
  const [cur, setCur] = useState(DEFAULT_CURRENCY)

  useEffect(() => {
    const country = detectCountry()
    setCur(CURRENCY_MAP[country] || DEFAULT_CURRENCY)
    fetch('/api/v1/payments/plans').then(r => r.json()).then(d => {
      if (d.plans && d.plans.length > 0) {
        setPlans(d.plans.map((p: Plan & { features: unknown }) => ({
          ...p,
          features: typeof p.features === 'string' ? JSON.parse(p.features as string) : (p.features || [])
        })))
      }
    }).catch(() => {})
  }, [])

  function getPrice(plan: Plan): string {
    const val = (plan as unknown as Record<string, number>)[cur.key]
    if (val === 0 || val === undefined) return 'Free'
    return cur.symbol + val + '/mo'
  }

  function onGetStarted(planId: string) {
    if (planId === 'free') { navigate('/login'); return }
    navigate('/checkout?plan=' + planId + '&currency=' + cur.code)
  }

  return (
    <div className={styles.root}>
      {/* NAV */}
      <nav className={styles.nav}>
        <Link to="/" className={styles.navLogo}>
          <span className={styles.logoPin}>📍</span>
          <span className={styles.logoText}>GRAVITY</span>
        </Link>
        <div className={styles.navRight}>
          <Link to="/#pricing" className={styles.navLink}>Compare Plans</Link>
          <Link to="/login" className={styles.navCta}>Sign In</Link>
        </div>
      </nav>

      {/* HERO */}
      <div className={styles.hero}>
        <div className={styles.heroLabel}>Simple Pricing</div>
        <h1 className={styles.heroTitle}>Plans for every family</h1>
        <p className={styles.heroSub}>Start free — upgrade anytime. Cancel anytime. No hidden charges.</p>

        {/* Currency selector */}
        <div className={styles.currencyRow}>
          <span className={styles.currencyLabel}>Prices in:</span>
          <select className={styles.currencySelect} value={cur.code} onChange={e => {
            const found = Object.values(CURRENCY_MAP).find(c => c.code === e.target.value)
            setCur(found || DEFAULT_CURRENCY)
          }}>
            <option value="USD">🌐 USD ($)</option>
            <option value="INR">🇮🇳 INR (₹)</option>
            <option value="KES">🇰🇪 KES (KSh)</option>
            <option value="EUR">🇪🇺 EUR (€)</option>
            <option value="GBP">🇬🇧 GBP (£)</option>
          </select>
        </div>
      </div>

      {/* PLAN CARDS */}
      <div className={styles.plansGrid}>
        {plans.map((plan, i) => (
          <div key={plan.id} className={styles.planCard + (plan.id === 'family' ? ' ' + styles.popularCard : '')}>
            {plan.id === 'family' && <div className={styles.popularBadge}>⭐ Most Popular</div>}
            <div className={styles.planTop}>
              <span className={styles.planIcon} style={{ color: PLAN_COLORS[i] }}>{PLAN_ICONS[i]}</span>
              <div className={styles.planName}>{plan.display_name}</div>
              <div className={styles.planPrice} style={{ color: PLAN_COLORS[i] }}>{getPrice(plan)}</div>
              <div className={styles.planMeta}>
                {plan.max_members} members · {plan.max_circles} circle{plan.max_circles > 1 ? 's' : ''} · {plan.history_days === 1 ? '24h' : plan.history_days + '-day'} history
              </div>
            </div>
            <ul className={styles.featureList}>
              {(Array.isArray(plan.features) ? plan.features : []).map((f: string) => (
                <li key={f} className={styles.featureItem}>
                  <span className={styles.check} style={{ color: PLAN_COLORS[i] }}>✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <button
              className={styles.planBtn + (plan.id === 'family' ? ' ' + styles.planBtnPrimary : plan.id === 'premium' ? ' ' + styles.planBtnPremium : '')}
              onClick={() => onGetStarted(plan.id)}
            >
              {plan.id === 'free' ? 'Start Free — No Card Needed' : 'Get ' + plan.display_name + ' →'}
            </button>
          </div>
        ))}
      </div>

      {/* PAYMENT METHODS */}
      <div className={styles.pmSection}>
        <p className={styles.pmTitle}>Accepted payment methods worldwide</p>
        <div className={styles.pmRow}>
          <div className={styles.pmBadge}><span>🇮🇳</span> Razorpay (UPI, Cards)</div>
          <div className={styles.pmBadge}><span>📱</span> M-Pesa (Kenya/Tanzania)</div>
          <div className={styles.pmBadge}><span>🌍</span> Pesapal (East Africa)</div>
          <div className={styles.pmBadge}><span>💳</span> Stripe (Cards, Global)</div>
          <div className={styles.pmBadge}><span>🌐</span> PayPal (145+ countries)</div>
        </div>
        <p className={styles.pmSub}>India · Kenya · Uganda · Tanzania · UK · USA · Europe · UAE · and 140+ more countries</p>
      </div>

      {/* FAQ */}
      <div className={styles.faq}>
        <h2 className={styles.faqTitle}>Questions answered</h2>
        <div className={styles.faqGrid}>
          {[
            { q:'Can I cancel anytime?',           a:'Yes. Cancel from your account settings. Access continues until the end of the current billing period. No questions asked.' },
            { q:'Which countries are supported?',  a:'India (Razorpay), Kenya & Tanzania (M-Pesa), Uganda, Rwanda & Zambia (Pesapal), UK, USA, Europe, UAE and 140+ countries via Stripe and PayPal.' },
            { q:'What currencies are accepted?',   a:'INR, KES, USD, EUR, GBP, AUD, CAD, AED, SGD and many more. Price shown automatically in your local currency.' },
            { q:'Is there a money-back guarantee?', a:'Yes. 7-day money-back guarantee on all paid plans. Contact support within 7 days of purchase for a full refund.' },
            { q:'How does the Free plan work?',    a:'The Free plan is free forever with no credit card required. You get up to 4 family members, 1 safe zone, SOS panic button, and 24-hour location history.' },
            { q:'When does my subscription renew?', a:'Monthly subscriptions renew automatically on the same date each month. You will receive an email reminder before renewal.' },
          ].map(item => (
            <div key={item.q} className={styles.faqItem}>
              <div className={styles.faqQ}>{item.q}</div>
              <div className={styles.faqA}>{item.a}</div>
            </div>
          ))}
        </div>
      </div>

      {/* FOOTER */}
      <div className={styles.footer}>
        <Link to="/" className={styles.footerBack}>← Back to Home</Link>
        <span className={styles.footerCopy}>© 2026 Trackalways · Gravity Family Safety</span>
        <Link to="/login" className={styles.footerLogin}>Sign In</Link>
      </div>
    </div>
  )
}
