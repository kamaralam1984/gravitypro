import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import styles from './Parent.module.css'

export default function Parent() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const heroRef = useRef<HTMLElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const [mobileOpen, setMobileOpen] = useState(false)

  // ── PARTICLE CANVAS ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const hero = heroRef.current
    if (!hero) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let W = 0, H = 0
    let animFrame: number
    interface Particle { x: number; y: number; vx: number; vy: number; r: number; alpha: number }
    let particles: Particle[] = []

    function resize() {
      W = canvas!.width = hero!.offsetWidth
      H = canvas!.height = hero!.offsetHeight
    }

    function makeParticle(): Particle {
      return {
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        r: Math.random() * 2 + 1,
        alpha: Math.random() * 0.5 + 0.15,
      }
    }

    function init() {
      particles = []
      for (let i = 0; i < 55; i++) particles.push(makeParticle())
    }

    function draw() {
      ctx!.clearRect(0, 0, W, H)
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        p.x += p.vx
        p.y += p.vy
        if (p.x < 0 || p.x > W) p.vx *= -1
        if (p.y < 0 || p.y > H) p.vy *= -1
        ctx!.beginPath()
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx!.fillStyle = `rgba(0,230,118,${p.alpha})`
        ctx!.fill()
        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j]
          const dx = p.x - q.x, dy = p.y - q.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 140) {
            const a = (1 - dist / 140) * 0.12
            ctx!.beginPath()
            ctx!.moveTo(p.x, p.y)
            ctx!.lineTo(q.x, q.y)
            ctx!.strokeStyle = `rgba(0,230,118,${a})`
            ctx!.lineWidth = 1
            ctx!.stroke()
          }
        }
      }
      animFrame = requestAnimationFrame(draw)
    }

    function onResize() { resize(); init() }
    window.addEventListener('resize', onResize)
    resize()
    init()
    draw()

    return () => {
      window.removeEventListener('resize', onResize)
      cancelAnimationFrame(animFrame)
    }
  }, [])

  // ── NAV SCROLL ──
  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    function onScroll() {
      if (window.scrollY > 30) nav!.classList.add(styles.scrolled)
      else nav!.classList.remove(styles.scrolled)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // ── INTERSECTION OBSERVER: SCROLL REVEALS ──
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement
            const idx = el.dataset.revealIdx
            if (idx !== undefined && !el.style.transitionDelay) {
              el.style.transitionDelay = parseInt(idx) * 0.1 + 's'
            }
            el.classList.add(styles.revealed)
            observer.unobserve(el)
          }
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    )

    const featureCards = document.querySelectorAll(`.${styles.featureCard}`)
    featureCards.forEach((card, i) => {
      ;(card as HTMLElement).dataset.revealIdx = String(i)
      observer.observe(card)
    })

    const steps = document.querySelectorAll(`.${styles.step}`)
    steps.forEach((step, i) => {
      ;(step as HTMLElement).dataset.revealIdx = String(i)
      observer.observe(step)
    })

    const tCards = document.querySelectorAll(`.${styles.testimonialCard}`)
    tCards.forEach((card, i) => {
      ;(card as HTMLElement).dataset.revealIdx = String(i)
      observer.observe(card)
    })

    const reveals = document.querySelectorAll(`.${styles.reveal}`)
    reveals.forEach((el) => observer.observe(el))

    return () => observer.disconnect()
  }, [])

  // ── STAT COUNTER ANIMATION ──
  useEffect(() => {
    const statItems = document.querySelectorAll(`.${styles.statItem}`)
    let counted = false

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add(styles.revealed)
        })
        if (!counted) {
          const anyVisible = entries.some((e) => e.isIntersecting)
          if (anyVisible) {
            counted = true
            statItems.forEach((item, idx) => {
              setTimeout(() => runCounter(item as HTMLElement), idx * 120)
            })
          }
        }
      },
      { threshold: 0.3 }
    )

    statItems.forEach((item) => observer.observe(item))

    function runCounter(item: HTMLElement) {
      const numEl = item.querySelector(`.${styles.statNum}`) as HTMLElement
      if (!numEl) return
      if (item.dataset.static) return
      const target = parseInt(item.dataset.target || '0', 10)
      const suffix = item.dataset.suffix || ''
      const scale = parseInt(item.dataset.scale || '1', 10)
      const duration = 1600
      const start = performance.now()
      function step(now: number) {
        const elapsed = now - start
        const progress = Math.min(elapsed / duration, 1)
        const ease = 1 - Math.pow(1 - progress, 3)
        const current = Math.round((ease * target) / scale)
        numEl.textContent = current + suffix
        if (progress < 1) requestAnimationFrame(step)
        else {
          if (scale === 1000) numEl.textContent = '10' + suffix
          else numEl.textContent = target + suffix
        }
      }
      requestAnimationFrame(step)
    }

    return () => observer.disconnect()
  }, [])

  function closeMobileNav() { setMobileOpen(false) }

  return (
    <>
      {/* ── NAV ── */}
      <nav ref={navRef} id="mainNav">
        <Link to="/" className={styles.navLogo} aria-label="Gravity Home">
          <div className={styles.navLogoIcon}>
            <svg className={styles.logoSvg} width="32" height="32" viewBox="0 0 40 40" fill="none">
              <defs>
                <linearGradient id="pinGrad" x1="12" y1="4" x2="28" y2="26" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#00FFB2" />
                  <stop offset="100%" stopColor="#00C853" />
                </linearGradient>
              </defs>
              <path d="M20 4C14.48 4 10 8.48 10 14c0 8.5 10 22 10 22s10-13.5 10-22c0-5.52-4.48-10-10-10z" fill="url(#pinGrad)" />
              <circle cx="20" cy="13.5" r="3.5" fill="rgba(5,12,8,0.85)" />
            </svg>
          </div>
          <span className={styles.navLogoText}>Gravity</span>
        </Link>
        <ul className={styles.navLinks}>
          <li><Link to="/parent" className="active">For Parents</Link></li>
          <li><Link to="/child">For Children</Link></li>
          <li><Link to="/">Home</Link></li>
        </ul>
        <label
          className={styles.hamburgerLabel}
          aria-label="Menu"
          onClick={() => setMobileOpen((o) => !o)}
        >
          <span></span><span></span><span></span>
        </label>
        <a href="#download" className={styles.navCta}>Download App</a>
      </nav>

      {/* ── MOBILE NAV ── */}
      <div className={`${styles.mobileNav} ${mobileOpen ? styles.mobileNavOpen : ''}`}>
        <ul>
          <li><Link to="/parent" className="active" onClick={closeMobileNav}>For Parents</Link></li>
          <li><Link to="/child" onClick={closeMobileNav}>For Children</Link></li>
          <li><Link to="/" onClick={closeMobileNav}>Home</Link></li>
          <li><a href="#features" onClick={closeMobileNav}>Features</a></li>
          <li><a href="#how" onClick={closeMobileNav}>How It Works</a></li>
        </ul>
        <a href="#download" className={styles.mobileCta} onClick={closeMobileNav}>Download App</a>
      </div>

      {/* ── HERO ── */}
      <section className={styles.hero} id="home" ref={heroRef}>
        <canvas ref={canvasRef} className={styles.heroCanvas} />
        <div className={styles.heroGrid} aria-hidden="true"></div>
        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>
            <span className={styles.badgeDot} aria-hidden="true"></span>
            For Parents &amp; Guardians
          </div>
          <h1>
            <span className={styles.lineBreak}>
              <span className="word" style={{ animationDelay: '0.15s' }}>Always</span>&nbsp;
              <span className="word" style={{ animationDelay: '0.23s' }}>Know</span>&nbsp;
              <span className="word" style={{ animationDelay: '0.31s' }}>Your</span>
            </span>
            <span className={`${styles.lineBreak} ${styles.accent}`}>
              <span className="word" style={{ animationDelay: '0.42s' }}>Family</span>&nbsp;
              <span className="word" style={{ animationDelay: '0.50s' }}>Is</span>&nbsp;
              <span className="word" style={{ animationDelay: '0.58s' }}>Safe</span>
            </span>
          </h1>
          <p className={styles.heroSub}>
            Real-time location, geofence alerts, and SOS notifications for every member of your family — all in one app.
          </p>
          <div className={styles.heroButtons}>
            <a href="#download" className={styles.btnPrimary}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download for Free
            </a>
            <a href="#how" className={styles.btnOutline}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 8 12 12 14 14" />
              </svg>
              See How It Works
            </a>
          </div>
          <div className={styles.trustBadges} role="list">
            <span className={styles.trustChip} role="listitem"><span className={styles.chipIcon}>🔒</span> End-to-End Encrypted</span>
            <span className={styles.trustChip} role="listitem"><span className={styles.chipIcon}>🔋</span> Battery Friendly</span>
            <span className={styles.trustChip} role="listitem"><span className={styles.chipIcon}>🌍</span> Works in 5 Countries</span>
            <span className={styles.trustChip} role="listitem"><span className={styles.chipIcon}>📱</span> iOS &amp; Android</span>
          </div>
          <div className={styles.familyCircles} aria-label="Trusted by families worldwide">
            <div className={styles.circleWrap}>
              <img src="https://picsum.photos/seed/woman-mom/60/60" alt="Mom" loading="lazy" />
            </div>
            <div className={styles.circleWrap}>
              <img src="https://picsum.photos/seed/man-dad/60/60" alt="Dad" loading="lazy" />
            </div>
            <div className={styles.circleWrap}>
              <img src="https://picsum.photos/seed/boy-rahul/60/60" alt="Child" loading="lazy" />
            </div>
            <span className={styles.familyMore}>+3 more family</span>
          </div>
        </div>
      </section>

      {/* ── STATS BAR ── */}
      <div className={styles.statsBar} role="region" aria-label="Key statistics">
        <div className={styles.statsInner}>
          <div className={styles.statItem} data-target="10000" data-suffix="K+" data-scale="1000">
            <span className={styles.statNum} aria-label="10K+ Families Protected">10K+</span>
            <span className={styles.statLabel}>Families Protected</span>
          </div>
          <div className={styles.statItem} data-target="5" data-suffix="">
            <span className={styles.statNum} aria-label="5 Countries">5</span>
            <span className={styles.statLabel}>Countries</span>
          </div>
          <div className={styles.statItem} data-static="lt3s">
            <span className={styles.statNum} aria-label="Under 3 seconds location update">&lt; 3s</span>
            <span className={styles.statLabel}>Location Update Speed</span>
          </div>
          <div className={styles.statItem} data-static="247">
            <span className={styles.statNum} aria-label="24/7 monitoring">24/7</span>
            <span className={styles.statLabel}>Always On Monitoring</span>
          </div>
        </div>
      </div>

      {/* ── FEATURES ── */}
      <section className={styles.featuresSection} id="features">
        <div className={styles.sectionWrap}>
          <div className={`${styles.sectionHeader} ${styles.reveal}`}>
            <span className={styles.sectionLabel}>Built for Parents</span>
            <h2 className={styles.sectionTitle}>Everything a parent needs</h2>
            <p className={styles.sectionSub}>Powerful tools designed to give you complete peace of mind — without intruding on your family's privacy.</p>
          </div>
          <div className={styles.featuresGrid}>

            <div className={styles.featureCard} style={{ transitionDelay: '0s' }}>
              <div className={styles.featureIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </div>
              <h3>Live Location Map</h3>
              <p>See exactly where every family member is, updated every few seconds. Full map view with real-time tracking.</p>
            </div>

            <div className={styles.featureCard} style={{ transitionDelay: '0.1s' }}>
              <div className={styles.featureIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <h3>Geofence Safe Zones</h3>
              <p>Draw zones around home, school, and work. Get instant alerts the moment anyone enters or leaves your defined area.</p>
            </div>

            <div className={`${styles.featureCard} ${styles.sos}`} style={{ transitionDelay: '0.2s' }}>
              <div className={styles.featureIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: '#FF5252' }}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <h3>SOS Panic Button</h3>
              <p>Your child presses one button. You receive an immediate alert with their exact location — every second counts.</p>
            </div>

            <div className={styles.featureCard} style={{ transitionDelay: '0.3s' }}>
              <div className={styles.featureIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="7" width="18" height="11" rx="2" />
                  <path d="M22 11v4" />
                  <line x1="6" y1="11" x2="6" y2="14" />
                  <line x1="10" y1="11" x2="10" y2="14" />
                  <line x1="14" y1="11" x2="14" y2="14" />
                </svg>
              </div>
              <h3>Battery Monitor</h3>
              <p>See everyone's battery level at a glance. Get low battery alerts before phones die and communication goes dark.</p>
            </div>

            <div className={styles.featureCard} style={{ transitionDelay: '0.4s' }}>
              <div className={styles.featureIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <h3>Location History</h3>
              <p>Review where family members have been with a complete 30-day history per member — clear, private, and secure.</p>
            </div>

            <div className={styles.featureCard} style={{ transitionDelay: '0.5s' }}>
              <div className={styles.featureIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <h3>Family Circles</h3>
              <p>Create a private group for your family. Invite members with a simple code — no email or account setup required.</p>
            </div>

          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className={styles.howSection} id="how">
        <div className={styles.sectionWrap}>
          <div className={`${styles.sectionHeader} ${styles.centered} ${styles.reveal}`}>
            <span className={styles.sectionLabel}>How It Works</span>
            <h2 className={styles.sectionTitle}>Set up in under 5 minutes</h2>
            <p className={styles.sectionSub}>Getting your family protected is simple. No technical knowledge needed — just four easy steps.</p>
          </div>
          <div className={styles.timeline} role="list">
            <div className={styles.timelineLine} aria-hidden="true"></div>

            <div className={styles.step} role="listitem">
              <div className={styles.stepNumberWrap} aria-hidden="true">
                <div className={styles.stepNum}>1</div>
              </div>
              <div className={styles.stepContent}>
                <h3>Download Gravity</h3>
                <p>Free on Android and iOS. Install in 30 seconds with no sign-up complexity. Just open and go.</p>
              </div>
            </div>

            <div className={styles.step} role="listitem">
              <div className={styles.stepNumberWrap} aria-hidden="true">
                <div className={styles.stepNum}>2</div>
              </div>
              <div className={styles.stepContent}>
                <h3>Create Family Circle</h3>
                <p>Choose a name for your family group and get a unique invite code instantly. Your private space is ready.</p>
              </div>
            </div>

            <div className={styles.step} role="listitem">
              <div className={styles.stepNumberWrap} aria-hidden="true">
                <div className={styles.stepNum}>3</div>
              </div>
              <div className={styles.stepContent}>
                <h3>Add Family Members</h3>
                <p>Share the code with your family. Each member joins with one tap — simple for children and seniors alike.</p>
              </div>
            </div>

            <div className={styles.step} role="listitem">
              <div className={styles.stepNumberWrap} aria-hidden="true">
                <div className={styles.stepNum}>4</div>
              </div>
              <div className={styles.stepContent}>
                <h3>Set Your Safe Zones</h3>
                <p>Draw geofence zones around home, school, and any important location. Alerts start working automatically.</p>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section className={styles.testimonialsSection} id="testimonials">
        <div className={styles.sectionWrap}>
          <div className={`${styles.sectionHeader} ${styles.centered} ${styles.reveal}`}>
            <span className={styles.sectionLabel}>Parent Stories</span>
            <h2 className={styles.sectionTitle}>Trusted by parents worldwide</h2>
            <p className={styles.sectionSub}>Real families sharing how Gravity changed their peace of mind every single day.</p>
          </div>
          <div className={styles.testimonialsGrid}>

            <div className={styles.testimonialCard}>
              <span className={styles.stars} aria-label="5 stars">★★★★★</span>
              <p className={styles.testimonialQuote}>"My daughter walks 1km to school every day. Gravity tells me the moment she arrives. I can't imagine parenting without it."</p>
              <div className={styles.testimonialAuthor}>
                <div className={styles.authorAvatar} style={{ background: 'linear-gradient(135deg,#0A5C35,#00C853)' }} aria-hidden="true">AK</div>
                <div>
                  <span className={styles.authorName}>Anita K.</span>
                  <span className={styles.authorLoc}>Mumbai, India</span>
                </div>
              </div>
            </div>

            <div className={styles.testimonialCard}>
              <span className={styles.stars} aria-label="5 stars">★★★★★</span>
              <p className={styles.testimonialQuote}>"My son is at university in another city. I check the app once a day and that's enough. Total peace of mind — exactly what I needed."</p>
              <div className={styles.testimonialAuthor}>
                <div className={styles.authorAvatar} style={{ background: 'linear-gradient(135deg,#1B5E20,#388E3C)' }} aria-hidden="true">JM</div>
                <div>
                  <span className={styles.authorName}>James M.</span>
                  <span className={styles.authorLoc}>Nairobi, Kenya</span>
                </div>
              </div>
            </div>

            <div className={styles.testimonialCard}>
              <span className={styles.stars} aria-label="5 stars">★★★★★</span>
              <p className={styles.testimonialQuote}>"Set up geofences around our whole neighborhood in Dubai. Any child leaves the zone, I know in seconds. It's like having eyes everywhere."</p>
              <div className={styles.testimonialAuthor}>
                <div className={styles.authorAvatar} style={{ background: 'linear-gradient(135deg,#0D47A1,#1565C0)' }} aria-hidden="true">FA</div>
                <div>
                  <span className={styles.authorName}>Fatima A.</span>
                  <span className={styles.authorLoc}>Dubai, UAE</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── DOWNLOAD CTA ── */}
      <section className={styles.ctaSection} id="download">
        <div className={styles.ctaInner}>
          <div className={styles.reveal}>
            <h2>Start Protecting Your Family Today</h2>
            <p>Free forever. No subscription. No ads.</p>
            <div className={styles.storeBadges}>
              <a href="https://play.google.com/store/apps/details?id=com.trackalways.gravity" className={styles.storeBadge} aria-label="Get it on Google Play" target="_blank" rel="noopener noreferrer">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3.5 2.5L13.5 12L3.5 21.5" stroke="#00E676" strokeWidth="2" strokeLinecap="round" />
                  <path d="M3.5 2.5L20 12L13.5 12" stroke="#00E676" strokeWidth="2" strokeLinecap="round" />
                  <path d="M3.5 21.5L13.5 12L20 12" stroke="#00C853" strokeWidth="2" strokeLinecap="round" />
                  <path d="M3.5 2.5L13.5 12L3.5 21.5" fill="#00E676" fillOpacity="0.15" />
                </svg>
                <div className={styles.storeText}>
                  <span className={styles.storeSmall}>Get it on</span>
                  <span className={styles.storeName}>Google Play</span>
                </div>
              </a>
              <a href="https://apps.apple.com/app/trackalways-gravity/id0000000000" className={styles.storeBadge} aria-label="Download on the App Store" target="_blank" rel="noopener noreferrer">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 2C10.5 2 9 3 9 4.5C9 3 7.5 2 6 2C4 2 2 4 2 7C2 11 7 16 12 20C17 16 22 11 22 7C22 4 20 2 18 2C16.5 2 15 3 15 4.5C15 3 13.5 2 12 2Z" stroke="#00E676" strokeWidth="1.5" fill="#00E676" fillOpacity="0.15" />
                  <path d="M12 6V18M9 9l3-3 3 3" stroke="#00E676" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div className={styles.storeText}>
                  <span className={styles.storeSmall}>Download on the</span>
                  <span className={styles.storeName}>App Store</span>
                </div>
              </a>
            </div>
            <p className={styles.ctaNote}>Available on Android &amp; iOS — built for parents</p>
          </div>
        </div>
      </section>

      {/* ── CROSS-PROMO ── */}
      <div className={styles.crossPromo}>
        <span>For your children:</span>
        <Link to="/child" className={styles.crossPromoLink}>See the Children's guide →</Link>
      </div>

      {/* ── FOOTER ── */}
      <footer>
        <div className={styles.footerInner}>
          <div className={styles.footerTop}>
            <div className={styles.footerBrand}>
              <Link to="/" className={styles.navLogo} aria-label="Gravity Home">
                <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
                  <circle cx="16" cy="13" r="7" fill="#0A5C35" />
                  <circle cx="16" cy="13" r="4" fill="#00E676" />
                  <path d="M16 20 L10 28 Q16 25 22 28 Z" fill="#0A5C35" />
                </svg>
                <span>GRAVITY</span>
              </Link>
              <p className={styles.footerTagline}>Keep your family connected and protected — wherever life takes them.</p>
            </div>
            <div className={styles.footerCol}>
              <h4>App</h4>
              <ul>
                <li><Link to="/">Home</Link></li>
                <li><Link to="/parent">For Parents</Link></li>
                <li><Link to="/child">For Children</Link></li>
                <li><a href="#download">Download</a></li>
              </ul>
            </div>
            <div className={styles.footerCol}>
              <h4>Product</h4>
              <ul>
                <li><a href="#features">Features</a></li>
                <li><a href="#how">How It Works</a></li>
                <li><a href="#testimonials">Reviews</a></li>
              </ul>
            </div>
            <div className={styles.footerCol}>
              <h4>Company</h4>
              <ul>
                <li><a href="#">Privacy Policy</a></li>
                <li><a href="#">Terms of Service</a></li>
                <li><a href="#">Contact Us</a></li>
              </ul>
            </div>
          </div>
          <div className={styles.footerBottom}>
            <p className={styles.footerCopyright}>© 2026 Trackalways. All rights reserved.</p>
            <span className={styles.footerBadge}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              Privacy First · Encrypted
            </span>
          </div>
        </div>
      </footer>
    </>
  )
}
