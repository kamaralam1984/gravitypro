import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import styles from './Child.module.css'

export default function Child() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [navScrolled, setNavScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  // Particle canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let W = 0, H = 0
    let animId: number

    interface Dot { x: number; y: number; r: number; vx: number; vy: number; a: number }
    const dots: Dot[] = []

    function rand(min: number, max: number) { return Math.random() * (max - min) + min }

    function resize() {
      W = canvas!.width = window.innerWidth
      H = canvas!.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    for (let i = 0; i < 70; i++) {
      dots.push({
        x: rand(0, window.innerWidth),
        y: rand(0, window.innerHeight),
        r: rand(0.8, 2.2),
        vx: rand(-0.45, 0.45),
        vy: rand(-0.45, 0.45),
        a: rand(0.15, 0.55)
      })
    }

    function draw() {
      ctx!.clearRect(0, 0, W, H)
      dots.forEach(d => {
        d.x += d.vx
        d.y += d.vy
        if (d.x < 0 || d.x > W) d.vx *= -1
        if (d.y < 0 || d.y > H) d.vy *= -1
        ctx!.beginPath()
        ctx!.arc(d.x, d.y, d.r, 0, Math.PI * 2)
        ctx!.fillStyle = `rgba(0,230,118,${d.a})`
        ctx!.fill()
      })
      dots.forEach((d, i) => {
        dots.slice(i + 1).forEach(d2 => {
          const dx = d.x - d2.x, dy = d.y - d2.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 110) {
            ctx!.beginPath()
            ctx!.moveTo(d.x, d.y)
            ctx!.lineTo(d2.x, d2.y)
            ctx!.strokeStyle = `rgba(0,230,118,${0.06 * (1 - dist / 110)})`
            ctx!.lineWidth = 0.6
            ctx!.stroke()
          }
        })
      })
      animId = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(animId)
    }
  }, [])

  // Nav scroll
  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 40)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Intersection Observer for reveal
  useEffect(() => {
    const els = document.querySelectorAll(
      `.${styles.reveal}, .${styles.featureCard}, .${styles.testiCard}, .${styles.privacyCard}, .${styles.stepRow}`
    )
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('visible')
          observer.unobserve(e.target)
        }
      })
    }, { threshold: 0.12 })
    els.forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  // Stat counters
  useEffect(() => {
    const nums = document.querySelectorAll<HTMLElement>(`.${styles.statNum}[data-target]`)
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (!e.isIntersecting) return
        const el = e.target as HTMLElement
        const target = parseInt(el.dataset.target || '0')
        const suffix = el.dataset.suffix || ''
        let current = 0
        const step = Math.max(1, Math.ceil(target / 40))
        const timer = setInterval(() => {
          current = Math.min(current + step, target)
          el.textContent = current + suffix
          if (current >= target) clearInterval(timer)
        }, 30)
        observer.unobserve(el)
      })
    }, { threshold: 0.5 })
    nums.forEach(n => observer.observe(n))
    return () => observer.disconnect()
  }, [])

  return (
    <>
      {/* NAV */}
      <nav className={`${styles.nav} ${navScrolled ? styles.navScrolled : ''}`} id="navbar">
        <Link to="/" className={styles.navLogo}>
          <div className={styles.navLogoIcon}>
            <svg className={styles.logoSvg} width="32" height="32" viewBox="0 0 40 40" fill="none">
              <defs>
                <linearGradient id="pinGradChild" x1="12" y1="4" x2="28" y2="26" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#00FFB2"/>
                  <stop offset="100%" stopColor="#00C853"/>
                </linearGradient>
              </defs>
              <path d="M20 4C14.48 4 10 8.48 10 14c0 8.5 10 22 10 22s10-13.5 10-22c0-5.52-4.48-10-10-10z" fill="url(#pinGradChild)"/>
              <circle cx="20" cy="13.5" r="3.5" fill="rgba(5,12,8,0.85)"/>
            </svg>
          </div>
          <span className={styles.navLogoText}>Gravity</span>
        </Link>
        <ul className={`${styles.navLinks} ${mobileOpen ? styles.navOpen : ''}`}>
          <li><Link to="/child" className={styles.active} onClick={() => setMobileOpen(false)}>For Children</Link></li>
          <li><Link to="/parent" onClick={() => setMobileOpen(false)}>For Parents</Link></li>
          <li><Link to="/" onClick={() => setMobileOpen(false)}>Home</Link></li>
          <li><a href="#download" className={styles.navCta} onClick={() => setMobileOpen(false)}>Join Your Family</a></li>
        </ul>
        <div
          className={`${styles.hamburger} ${mobileOpen ? styles.hamburgerOpen : ''}`}
          onClick={() => setMobileOpen(v => !v)}
          aria-label="Toggle menu"
        >
          <span></span><span></span><span></span>
        </div>
      </nav>

      {/* HERO */}
      <section className={styles.hero} id="hero">
        <canvas className={styles.particles} ref={canvasRef} id="particles"></canvas>
        <div className={styles.heroBefore}></div>
        <div className={styles.heroContent}>
          <div className={styles.badge}>
            <span className={styles.pulseDot}></span>
            🛡 For Kids &amp; Teens
          </div>
          <h1 className={styles.heroH1}>
            <span className={styles.line}>
              <span className={styles.word} style={{animationDelay:'0.1s'}}>Stay</span>
              <span className={styles.word} style={{animationDelay:'0.2s'}}>&nbsp;Connected,</span>
            </span>
            <span className={`${styles.line} ${styles.accentLine}`}>
              <span className={styles.word} style={{animationDelay:'0.35s'}}>Stay</span>
              <span className={styles.word} style={{animationDelay:'0.45s'}}>&nbsp;Safe.</span>
            </span>
          </h1>
          <p className={styles.heroSub}>Share your location with family, press SOS in an emergency, and let everyone know you got home safe — without the awkward calls.</p>
          <div className={styles.heroBtns}>
            <a href="#download" className={styles.btnPrimary}>Join Your Family</a>
            <a href="#features" className={styles.btnGlass}>See Features</a>
            <Link to="/login?redirect=/child/panel" className={styles.btnGlass}>Open Child Panel</Link>
          </div>
          <div className={styles.socialProof}>
            <p>Already used by families in 5 countries</p>
            <div className={styles.flags}>
              <span>🇰🇪</span>
              <span>🇮🇳</span>
              <span>🇦🇪</span>
              <span>🇬🇧</span>
              <span>🇺🇸</span>
            </div>
          </div>
          <div className={styles.phoneWrap}>
            <div className={styles.phone}>
              <div className={styles.phoneBg}></div>
              <div className={styles.phoneNotch}></div>
              <div className={styles.phoneStatus}>
                <span>9:41</span>
                <div className={styles.phoneStatusIcons}>
                  <span>📶</span>
                  <span>🔋</span>
                </div>
              </div>
              <div className={styles.phoneContent}>
                <div className={styles.phoneAppLabel}>Gravity · Live Location</div>
                <div className={styles.phoneMapArea}>
                  <div className={styles.phoneMapGrid}></div>
                  <div className={styles.phoneMapDot}></div>
                </div>
                <div className={styles.phoneNotification}>
                  <div className={styles.notifIcon}>✓</div>
                  <div>
                    <div className={styles.notifTitle}>You're home! Family notified ✓</div>
                    <div className={styles.notifSub}>Gravity · Just now</div>
                  </div>
                </div>
                <div className={styles.phoneHomeBar}></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* STATS BAR */}
      <div className={styles.stats} id="stats">
        <div className={styles.statsGrid}>
          <div className={`stat-item ${styles.reveal}`}>
            <div className={styles.statNum} data-target="30" data-suffix="s">0s</div>
            <div className={styles.statLabel}>Setup Time</div>
          </div>
          <div className={`stat-item ${styles.reveal}`} style={{transitionDelay:'0.1s'}}>
            <div className={styles.statNum}>1 tap</div>
            <div className={styles.statLabel}>Share Location</div>
          </div>
          <div className={`stat-item ${styles.reveal}`} style={{transitionDelay:'0.2s'}}>
            <div className={styles.statNum}>SOS</div>
            <div className={styles.statLabel}>Emergency Alert</div>
          </div>
          <div className={`stat-item ${styles.reveal}`} style={{transitionDelay:'0.3s'}}>
            <div className={styles.statNum}>Always</div>
            <div className={styles.statLabel}>Family Connection</div>
          </div>
        </div>
      </div>

      {/* FEATURES */}
      <section className={`${styles.section} ${styles.features}`} id="features">
        <div className={`${styles.sectionHead} ${styles.reveal}`}>
          <span className={styles.sectionLabel}>FOR YOU</span>
          <h2 className={styles.sectionTitle}>Everything you need to stay safe</h2>
          <p className={styles.sectionSub}>Designed for kids and teens who want independence — and families who want peace of mind.</p>
        </div>
        <div className={styles.featuresGrid}>
          <div className={`${styles.featureCard} ${styles.reveal}`} style={{transitionDelay:'0.05s'}}>
            <div className={styles.featIcon}>📍</div>
            <div className={styles.featTitle}>Share Location with Family</div>
            <p className={styles.featDesc}>Let your family know where you are with one tap. No awkward calls needed.</p>
          </div>
          <div className={`${styles.featureCard} ${styles.sosCard} ${styles.reveal}`} style={{transitionDelay:'0.1s'}}>
            <div className={styles.featIcon}>🚨</div>
            <div className={styles.featTitle}>SOS Panic Button</div>
            <p className={styles.featDesc}>Feeling unsafe? One big tap sends your location to your whole family instantly.</p>
          </div>
          <div className={`${styles.featureCard} ${styles.reveal}`} style={{transitionDelay:'0.15s'}}>
            <div className={styles.featIcon}>✅</div>
            <div className={styles.featTitle}>Arrive Safe Alerts</div>
            <p className={styles.featDesc}>Gravity automatically notifies your family when you reach home, school, or any zone.</p>
          </div>
          <div className={`${styles.featureCard} ${styles.reveal}`} style={{transitionDelay:'0.2s'}}>
            <div className={styles.featIcon}>🔒</div>
            <div className={styles.featTitle}>Private Circle</div>
            <p className={styles.featDesc}>Only YOUR family can see your location. Nobody else. No strangers, no ads.</p>
          </div>
          <div className={`${styles.featureCard} ${styles.reveal}`} style={{transitionDelay:'0.25s'}}>
            <div className={styles.featIcon}>⚡</div>
            <div className={styles.featTitle}>Battery Saver</div>
            <p className={styles.featDesc}>Background location tracking is designed to use minimal battery. Your phone stays alive all day.</p>
          </div>
          <div className={`${styles.featureCard} ${styles.reveal}`} style={{transitionDelay:'0.3s'}}>
            <div className={styles.featIcon}>👋</div>
            <div className={styles.featTitle}>Check-In</div>
            <p className={styles.featDesc}>Quick tap to send "I'm okay" to your whole family. Takes 1 second.</p>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className={`${styles.section} ${styles.how}`} id="how">
        <div className={`${styles.sectionHead} ${styles.reveal}`}>
          <span className={styles.sectionLabel}>HOW IT WORKS</span>
          <h2 className={styles.sectionTitle}>Get set up in 60 seconds</h2>
          <p className={styles.sectionSub}>Seriously, it's that simple. No complicated setup, no confusing menus.</p>
        </div>
        <div className={styles.stepsTimeline}>
          {/* Step 1 */}
          <div className={`${styles.stepRow} ${styles.reveal}`}>
            <div className={styles.stepCard}>
              <div className={styles.stepNum}>Step 01</div>
              <div className={styles.stepTitle}>Download Gravity</div>
              <p className={styles.stepDesc}>Find it on Google Play or App Store. It's free.</p>
            </div>
            <div className={styles.stepCenter}>
              <div className={styles.stepCircle}>1</div>
              <div className={styles.stepLine}></div>
            </div>
            <div></div>
          </div>
          {/* Step 2 */}
          <div className={`${styles.stepRow} ${styles.reveal}`} style={{transitionDelay:'0.1s'}}>
            <div></div>
            <div className={styles.stepCenter}>
              <div className={styles.stepCircle}>2</div>
              <div className={styles.stepLine}></div>
            </div>
            <div className={styles.stepCard}>
              <div className={styles.stepNum}>Step 02</div>
              <div className={styles.stepTitle}>Enter Family Code</div>
              <p className={styles.stepDesc}>Your parent will send you a code. Enter it and join your family circle.</p>
            </div>
          </div>
          {/* Step 3 */}
          <div className={`${styles.stepRow} ${styles.reveal}`} style={{transitionDelay:'0.2s'}}>
            <div className={styles.stepCard}>
              <div className={styles.stepNum}>Step 03</div>
              <div className={styles.stepTitle}>Enable Location</div>
              <p className={styles.stepDesc}>Allow location access. Gravity uses it only with your family.</p>
            </div>
            <div className={styles.stepCenter}>
              <div className={styles.stepCircle}>3</div>
              <div className={styles.stepLine}></div>
            </div>
            <div></div>
          </div>
          {/* Step 4 */}
          <div className={`${styles.stepRow} ${styles.stepRowLast} ${styles.reveal}`} style={{transitionDelay:'0.3s'}}>
            <div></div>
            <div className={styles.stepCenter}>
              <div className={styles.stepCircle}>4</div>
              <div className={styles.stepLine}></div>
            </div>
            <div className={styles.stepCard}>
              <div className={styles.stepNum}>Step 04</div>
              <div className={styles.stepTitle}>You're Connected</div>
              <p className={styles.stepDesc}>Your family can see you. You can see them. Press SOS anytime.</p>
            </div>
          </div>
        </div>
      </section>

      {/* SAFETY & PRIVACY */}
      <section className={`${styles.section} ${styles.privacy}`} id="privacy">
        <div className={styles.privacyInner}>
          <div className={styles.reveal}>
            <span className={styles.sectionLabel}>YOUR PRIVACY MATTERS</span>
            <h2 className={styles.sectionTitle}>Your location, your control.</h2>
            <p className={styles.sectionSub} style={{margin:'0 auto'}}>Gravity is designed for trust, not surveillance. You control what your family sees.</p>
          </div>
          <div className={styles.privacyCards}>
            <div className={`${styles.privacyCard} ${styles.reveal}`} style={{transitionDelay:'0.1s'}}>
              <span className={styles.privacyCardIcon}>🔒</span>
              <p className={styles.privacyCardText}>Only your approved circle can ever see your location.</p>
            </div>
            <div className={`${styles.privacyCard} ${styles.reveal}`} style={{transitionDelay:'0.2s'}}>
              <span className={styles.privacyCardIcon}>👁</span>
              <p className={styles.privacyCardText}>You can pause location sharing anytime with one tap.</p>
            </div>
            <div className={`${styles.privacyCard} ${styles.reveal}`} style={{transitionDelay:'0.3s'}}>
              <span className={styles.privacyCardIcon}>🚫</span>
              <p className={styles.privacyCardText}>No ads. No data selling. No strangers. Ever.</p>
            </div>
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className={`${styles.section} ${styles.testimonials}`} id="testimonials">
        <div className={`${styles.sectionHead} ${styles.reveal}`}>
          <span className={styles.sectionLabel}>WHAT YOUNG USERS SAY</span>
          <h2 className={styles.sectionTitle}>Real stories from real kids</h2>
          <p className={styles.sectionSub}>Not from adults. From kids and teens just like you.</p>
        </div>
        <div className={styles.testimonialsGrid}>
          <div className={`${styles.testiCard} ${styles.reveal}`} style={{transitionDelay:'0.05s'}}>
            <div className={styles.testiStars}>⭐⭐⭐⭐⭐</div>
            <p className={styles.testiQuote}>"My parents used to call me every hour. Now they check the app. So much less annoying!"</p>
            <div className={styles.testiAuthor}>
              <div className={styles.testiAvatar}>R</div>
              <div>
                <div className={styles.testiName}>Rahul, 17</div>
                <div className={styles.testiLoc}>Mumbai, India 🇮🇳</div>
              </div>
            </div>
          </div>
          <div className={`${styles.testiCard} ${styles.reveal}`} style={{transitionDelay:'0.1s'}}>
            <div className={styles.testiStars}>⭐⭐⭐⭐⭐</div>
            <p className={styles.testiQuote}>"I was walking home late and felt unsafe. Pressed SOS and my dad was there in 8 minutes."</p>
            <div className={styles.testiAuthor}>
              <div className={styles.testiAvatar}>A</div>
              <div>
                <div className={styles.testiName}>Arya, 16</div>
                <div className={styles.testiLoc}>Delhi, India 🇮🇳</div>
              </div>
            </div>
          </div>
          <div className={`${styles.testiCard} ${styles.reveal}`} style={{transitionDelay:'0.15s'}}>
            <div className={styles.testiStars}>⭐⭐⭐⭐⭐</div>
            <p className={styles.testiQuote}>"I like that I can see where my parents are too. Feels fair."</p>
            <div className={styles.testiAuthor}>
              <div className={styles.testiAvatar}>P</div>
              <div>
                <div className={styles.testiName}>Pinky, 15</div>
                <div className={styles.testiLoc}>Dubai, UAE 🇦🇪</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* DOWNLOAD CTA */}
      <section className={`${styles.section} ${styles.download}`} id="download">
        <div className={styles.downloadInner}>
          <h2 className={`${styles.downloadH2} ${styles.reveal}`}>Join Your Family on <span>Gravity</span></h2>
          <p className={`${styles.downloadSub} ${styles.reveal}`} style={{transitionDelay:'0.1s'}}>Free for everyone. Always.</p>
          <div className={`${styles.storeBadges} ${styles.reveal}`} style={{transitionDelay:'0.2s'}}>
            <a href="https://apps.apple.com/app/trackalways-gravity/id0000000000" className={styles.storeBtn} target="_blank" rel="noopener noreferrer">
              <span className={styles.storeIcon}>🍎</span>
              <div>
                <div className={styles.storeLabel}>Download on the</div>
                <div className={styles.storeName}>App Store</div>
              </div>
            </a>
            <a href="https://play.google.com/store/apps/details?id=com.trackalways.gravity" className={styles.storeBtn} target="_blank" rel="noopener noreferrer">
              <span className={styles.storeIcon}>▶</span>
              <div>
                <div className={styles.storeLabel}>Get it on</div>
                <div className={styles.storeName}>Google Play</div>
              </div>
            </a>
          </div>
          <p className={`${styles.downloadNote} ${styles.reveal}`} style={{transitionDelay:'0.3s'}}>Your parents can add you to their circle</p>
        </div>
      </section>

      {/* CROSS-PROMO */}
      <div className={styles.crossPromo}>
        <span>Are you a parent?</span>
        <Link to="/parent" className={styles.crossPromoLink}>See the Parent's guide →</Link>
      </div>

      {/* FOOTER */}
      <footer className={styles.footer}>
        <div className={styles.footerGrid}>
          <div className={styles.footerBrand}>
            <div className={styles.footerBrandLogo}>Gravity<span>.</span></div>
            <p>Stay connected with the people who matter most. Safe, simple, and always there when you need it.</p>
          </div>
          <div className={styles.footerCol}>
            <h4>Product</h4>
            <ul>
              <li><a href="#features">Features</a></li>
              <li><a href="#how">How it Works</a></li>
              <li><a href="#download">Download</a></li>
            </ul>
          </div>
          <div className={styles.footerCol}>
            <h4>Audience</h4>
            <ul>
              <li><Link to="/child">For Kids &amp; Teens</Link></li>
              <li><Link to="/parent">For Parents</Link></li>
              <li><Link to="/">Home</Link></li>
            </ul>
          </div>
          <div className={styles.footerCol}>
            <h4>Legal</h4>
            <ul>
              <li><a href="#">Privacy Policy</a></li>
              <li><a href="#">Terms of Service</a></li>
              <li><a href="#">Contact Us</a></li>
            </ul>
          </div>
        </div>
        <div className={styles.footerBottom}>
          <p>&copy; 2026 Gravity. All rights reserved.</p>
          <p>Made with care for families everywhere 🌍</p>
        </div>
      </footer>
    </>
  )
}
