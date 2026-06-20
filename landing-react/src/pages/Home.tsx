import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import styles from './Home.module.css'
import 'leaflet/dist/leaflet.css'
import type L from 'leaflet'

export default function Home() {
  const navRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const leafletMapRef = useRef<L.Map | null>(null)
  const [navScrolled, setNavScrolled] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [activeMapType, setActiveMapType] = useState<'dark' | 'light' | 'satellite' | 'street'>('dark')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const activeTileRef = useRef<L.TileLayer | null>(null)

  // Nav scroll effect
  useEffect(() => {
    const handleScroll = () => {
      setNavScrolled(window.scrollY > 30)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Active section tracking
  useEffect(() => {
    const navLinks = document.querySelectorAll(`.${styles.navLinks} a[href^="#"]`)
    const sectionIds = Array.from(navLinks)
      .map(a => a.getAttribute('href')?.slice(1))
      .filter(Boolean) as string[]
    const sectionEls = sectionIds.map(id => document.getElementById(id)).filter(Boolean) as HTMLElement[]

    const sectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          navLinks.forEach(a => a.classList.remove('active'))
          const match = document.querySelector(`.${styles.navLinks} a[href="#${entry.target.id}"]`)
          if (match) match.classList.add('active')
        }
      })
    }, { threshold: 0.3, rootMargin: '-60px 0px -35% 0px' })
    sectionEls.forEach(el => sectionObserver.observe(el))
    return () => sectionObserver.disconnect()
  }, [])

  // Canvas particle network
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let W = 0, H = 0
    const COLORS = ['#00E676', '#00C853', '#0A5C35', 'rgba(0,230,118,0.6)']
    const NUM_DOTS = 55
    const MAX_DIST = 130
    let animId: number

    function resize() {
      W = canvas!.width = canvas!.offsetWidth
      H = canvas!.height = canvas!.offsetHeight
    }
    window.addEventListener('resize', resize)
    resize()

    type Dot = { x: number; y: number; size: number; opacity: number; vx: number; vy: number; color: string }
    const dots: Dot[] = Array.from({ length: NUM_DOTS }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      size: 1.5 + Math.random() * 1.5,
      opacity: 0.4 + Math.random() * 0.4,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      color: COLORS[Math.floor(Math.random() * COLORS.length)]
    }))

    function draw() {
      ctx!.clearRect(0, 0, W, H)
      dots.forEach(d => {
        d.x += d.vx; d.y += d.vy
        if (d.x < 0 || d.x > W) d.vx *= -1
        if (d.y < 0 || d.y > H) d.vy *= -1
      })
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const dx = dots[i].x - dots[j].x
          const dy = dots[i].y - dots[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < MAX_DIST) {
            const alpha = (1 - dist / MAX_DIST) * 0.25
            ctx!.beginPath()
            ctx!.strokeStyle = `rgba(0,230,118,${alpha})`
            ctx!.lineWidth = 0.8
            ctx!.moveTo(dots[i].x, dots[i].y)
            ctx!.lineTo(dots[j].x, dots[j].y)
            ctx!.stroke()
          }
        }
      }
      dots.forEach(d => {
        ctx!.beginPath()
        ctx!.arc(d.x, d.y, d.size, 0, Math.PI * 2)
        ctx!.fillStyle = d.color
        ctx!.globalAlpha = d.opacity
        ctx!.fill()
        ctx!.globalAlpha = 1
      })
      animId = requestAnimationFrame(draw)
    }
    draw()
    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  // Leaflet map
  useEffect(() => {
    if (!mapRef.current) return
    let intervalId: ReturnType<typeof setInterval>

    import('leaflet').then((L) => {
      if (!mapRef.current) return
      if (leafletMapRef.current) {
        leafletMapRef.current.remove()
        leafletMapRef.current = null
      }

      const map = L.map(mapRef.current, {
        center: [19.076, 72.8777],
        zoom: 13,
        zoomControl: false,
        attributionControl: false
      })
      leafletMapRef.current = map

      const INDEX_TILES: Record<string, { url: string; opts: L.TileLayerOptions }> = {
        dark:      { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',           opts: { subdomains: 'abcd', maxZoom: 19 } },
        light:     { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',          opts: { subdomains: 'abcd', maxZoom: 19 } },
        satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', opts: { maxZoom: 19 } },
        street:    { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', opts: { subdomains: 'abcd', maxZoom: 19 } }
      }

      activeTileRef.current = L.tileLayer(INDEX_TILES.dark.url, INDEX_TILES.dark.opts).addTo(map)

      // Inject pin CSS
      const pinStyle = document.createElement('style')
      pinStyle.textContent =
        '.map-pin-wrap{position:relative;display:flex;flex-direction:column;align-items:center;}' +
        '.map-pin-circle{width:52px;height:52px;border-radius:50%;border:3px solid var(--pin-color);overflow:hidden;background:#0D2018;box-shadow:0 4px 20px rgba(0,0,0,.5);position:relative;z-index:2;}' +
        '.map-pin-circle img{width:100%;height:100%;object-fit:cover;display:block;}' +
        '.map-pin-ring{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);border-radius:50%;border:2px solid var(--pin-color);opacity:0;animation:mapPingRing 2.5s ease-out infinite;}' +
        '.ring1{width:60px;height:60px;animation-delay:0s;}' +
        '.ring2{width:80px;height:80px;animation-delay:.6s;}' +
        '@keyframes mapPingRing{0%{opacity:.7;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.8)}}' +
        '.map-pin-label{margin-top:4px;background:rgba(5,15,8,.9);border:1px solid var(--pin-color);border-radius:100px;padding:3px 10px;font-size:11px;font-weight:700;color:#fff;white-space:nowrap;z-index:2;position:relative;font-family:"Plus Jakarta Sans",sans-serif;}' +
        '.pin-speed{color:var(--pin-color);font-size:9px;opacity:.8;}' +
        '.leaflet-attribution-flag{display:none!important;}' +
        '.conn-line{stroke-dasharray:12 7;animation:dashFlow 1.2s linear infinite;}' +
        '@keyframes dashFlow{to{stroke-dashoffset:-19;}}' +
        '.dist-badge{display:inline-flex;align-items:center;gap:5px;background:rgba(5,12,8,0.88);border:1px solid var(--lc);border-radius:100px;padding:3px 9px;font-size:11px;font-weight:700;color:#fff;white-space:nowrap;font-family:"Plus Jakarta Sans",sans-serif;pointer-events:none;box-shadow:0 2px 12px rgba(0,0,0,.5);}' +
        '.dist-arrow{color:var(--lc);font-size:13px;line-height:1;animation:arrowPulse 1s ease-in-out infinite alternate;}' +
        '.dist-km{color:#E8F5E9;font-size:10px;font-weight:600;opacity:.9;}' +
        '@keyframes arrowPulse{from{opacity:.5;transform:translateX(-2px);}to{opacity:1;transform:translateX(2px);}}'
      document.head.appendChild(pinStyle)

      const family = [
        { name: 'Mom',      seed: 'woman-mom',  lat: 19.0820, lng: 72.8650, color: '#00E676', speed: null      },
        { name: 'Dad',      seed: 'man-dad',    lat: 19.0750, lng: 72.8850, color: '#00C853', speed: '28km/h'  },
        { name: 'Rahul',    seed: 'boy-rahul',  lat: 19.0880, lng: 72.8900, color: '#29B6F6', speed: '18km/h'  },
        { name: 'Pinky',    seed: 'girl-pinky', lat: 19.0680, lng: 72.8780, color: '#FFB300', speed: '5km/h'   },
        { name: 'Grand Pa', seed: 'oldman-gp',  lat: 19.0920, lng: 72.8620, color: '#AB47BC', speed: null      },
        { name: 'Grand Mom',seed: 'woman-gm',   lat: 19.0650, lng: 72.8870, color: '#5E8B6E', speed: null      }
      ]

      type FamilyMember = typeof family[0]
      type MarkerItem = { marker: L.Marker; member: FamilyMember; baseLat: number; baseLng: number }
      const markers: MarkerItem[] = []

      family.forEach(member => {
        const speedHtml = member.speed ? `<span class="pin-speed"> ${member.speed}</span>` : ''
        const icon = L.divIcon({
          className: '',
          html:
            `<div class="map-pin-wrap" style="--pin-color:${member.color}">` +
              `<div class="map-pin-ring ring1"></div>` +
              `<div class="map-pin-ring ring2"></div>` +
              `<div class="map-pin-circle">` +
                `<img src="https://picsum.photos/seed/${member.seed}/56/56" alt="${member.name}" ` +
                  `onerror="this.style.display='none';this.parentElement.style.background='${member.color}'">` +
              `</div>` +
              `<div class="map-pin-label">${member.name}${speedHtml}</div>` +
            `</div>`,
          iconSize: [80, 90] as [number, number],
          iconAnchor: [40, 70] as [number, number]
        })
        const marker = L.marker([member.lat, member.lng], { icon }).addTo(map)
        markers.push({ marker, member, baseLat: member.lat, baseLng: member.lng })
      })

      function haversine(lat1: number, lng1: number, lat2: number, lng2: number): string {
        const R = 6371
        const dLat = (lat2 - lat1) * Math.PI / 180
        const dLng = (lng2 - lng1) * Math.PI / 180
        const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
                Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*
                Math.sin(dLng/2)*Math.sin(dLng/2)
        return (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))).toFixed(1)
      }

      const connections: [number, number, string][] = [
        [0, 1, '#00E676'],
        [0, 2, '#00C853'],
        [0, 3, '#FFB300'],
        [1, 2, '#29B6F6'],
        [4, 0, '#AB47BC'],
        [5, 1, '#5E8B6E'],
      ]

      type LineItem = { line: L.Polyline; distMarker: L.Marker; fi: number; ti: number }
      const lineMarkers: LineItem[] = []

      connections.forEach(conn => {
        const f = family[conn[0]], t = family[conn[1]], color = conn[2]
        const dist = haversine(f.lat, f.lng, t.lat, t.lng)
        const midLat = (f.lat + t.lat) / 2
        const midLng = (f.lng + t.lng) / 2

        const line = L.polyline([[f.lat, f.lng],[t.lat, t.lng]], {
          color,
          weight: 2,
          opacity: 0.65,
          dashArray: '12 7',
          className: 'conn-line'
        }).addTo(map)

        const distIcon = L.divIcon({
          className: '',
          html: `<div class="dist-badge" style="--lc:${color}"><span class="dist-arrow">→</span><span class="dist-km">${dist} km</span></div>`,
          iconSize: [80, 22] as [number, number],
          iconAnchor: [40, 11] as [number, number]
        })
        const distMarker = L.marker([midLat, midLng], {
          icon: distIcon,
          interactive: false,
          zIndexOffset: -100
        }).addTo(map)
        lineMarkers.push({ line, distMarker, fi: conn[0], ti: conn[1] })
      })

      function animateMarkers() {
        markers.forEach(item => {
          if (item.member.speed) {
            const jitter = () => (Math.random() - 0.5) * 0.003
            item.marker.setLatLng([item.baseLat + jitter(), item.baseLng + jitter()])
          }
        })
        lineMarkers.forEach(lm => {
          const f = markers[lm.fi].marker.getLatLng()
          const t = markers[lm.ti].marker.getLatLng()
          lm.line.setLatLngs([f, t])
          const mid: [number, number] = [(f.lat + t.lat) / 2, (f.lng + t.lng) / 2]
          lm.distMarker.setLatLng(mid)
          const d = haversine(f.lat, f.lng, t.lat, t.lng)
          const el = lm.distMarker.getElement()
          if (el) {
            const km = el.querySelector('.dist-km')
            if (km) km.textContent = `${d} km`
          }
        })
      }

      intervalId = setInterval(animateMarkers, 4000)
    })

    return () => {
      clearInterval(intervalId)
      if (leafletMapRef.current) {
        leafletMapRef.current.remove()
        leafletMapRef.current = null
      }
    }
  }, [])

  // Reveal on scroll observer
  useEffect(() => {
    const revealEls = document.querySelectorAll(`.${styles.revealUp}, .${styles.fc2Card}`)
    const revealObs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add(styles.visible)
          revealObs.unobserve(e.target)
        }
      })
    }, { threshold: 0.1, rootMargin: '0px 0px -60px 0px' })
    revealEls.forEach(el => revealObs.observe(el))
    return () => revealObs.disconnect()
  }, [])

  // Step scroll reveal
  useEffect(() => {
    const stepObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add(styles.visible)
          stepObserver.unobserve(entry.target)
        }
      })
    }, { threshold: 0.2, rootMargin: '0px 0px -60px 0px' })
    document.querySelectorAll(`.${styles.stepContent}`).forEach(el => stepObserver.observe(el))
    return () => stepObserver.disconnect()
  }, [])

  // Stats counter animation
  useEffect(() => {
    const statsBar = document.querySelector(`.${styles.statsBar}`) as HTMLElement
    if (!statsBar) return
    let statsCounted = false

    function countUp(el: HTMLElement, target: number, suffix: string) {
      const duration = 1800
      const start = performance.now()
      function update(now: number) {
        const progress = Math.min((now - start) / duration, 1)
        const eased = 1 - Math.pow(1 - progress, 3)
        const current = Math.floor(eased * target)
        el.textContent = target >= 1000 ? Math.floor(current / 1000) + 'K+' : current + suffix
        if (progress < 1) requestAnimationFrame(update)
        else el.textContent = target >= 1000 ? '50K+' : target + suffix
      }
      requestAnimationFrame(update)
    }

    const statsObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !statsCounted) {
          statsCounted = true
          statsBar.querySelectorAll('[data-count]').forEach(el => {
            const htmlEl = el as HTMLElement
            const target = parseInt(htmlEl.getAttribute('data-count') || '0', 10)
            const suffix = htmlEl.textContent?.includes('%') ? '%' : ''
            countUp(htmlEl, target, suffix)
          })
        }
      })
    }, { threshold: 0.3 })
    statsObserver.observe(statsBar)
    return () => statsObserver.disconnect()
  }, [])

  function switchMap(type: 'dark' | 'light' | 'satellite' | 'street') {
    setActiveMapType(type)
    import('leaflet').then((L) => {
      const map = leafletMapRef.current
      if (!map) return
      const INDEX_TILES: Record<string, { url: string; opts: L.TileLayerOptions }> = {
        dark:      { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',           opts: { subdomains: 'abcd', maxZoom: 19 } },
        light:     { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',          opts: { subdomains: 'abcd', maxZoom: 19 } },
        satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', opts: { maxZoom: 19 } },
        street:    { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', opts: { subdomains: 'abcd', maxZoom: 19 } }
      }
      if (activeTileRef.current) map.removeLayer(activeTileRef.current)
      activeTileRef.current = L.tileLayer(INDEX_TILES[type].url, INDEX_TILES[type].opts).addTo(map)
      activeTileRef.current.bringToBack()
    })
  }

  function mapZoom(delta: number) {
    const map = leafletMapRef.current
    if (!map) return
    map.setZoom(map.getZoom() + delta, { animate: true })
  }

  return (
    <>
      {/* ===== NAV ===== */}
      <input
        type="checkbox"
        className={styles.hamburgerInput}
        id="nav-toggle"
        checked={mobileMenuOpen}
        onChange={e => setMobileMenuOpen(e.target.checked)}
      />
      <nav
        ref={navRef}
        className={`${styles.nav}${navScrolled ? ' ' + styles.navScrolled : ''}`}
        id="mainNav"
      >
        <a href="#hero" className={styles.navLogo}>
          <div className={styles.navLogoIcon}>
            <svg className={styles.logoSvg} width="32" height="32" viewBox="0 0 40 40" fill="none">
              <defs>
                <linearGradient id="pinGrad" x1="12" y1="4" x2="28" y2="26" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#00FFB2"/>
                  <stop offset="100%" stopColor="#00C853"/>
                </linearGradient>
                <radialGradient id="pinGlow" cx="50%" cy="40%" r="50%">
                  <stop offset="0%" stopColor="rgba(0,255,180,0.18)"/>
                  <stop offset="100%" stopColor="rgba(0,200,83,0)"/>
                </radialGradient>
              </defs>
              <ellipse cx="20" cy="36" rx="7" ry="2" fill="url(#pinGlow)" opacity="0.5"/>
              <g className={styles.logoPin}>
                <path d="M20 4C14.48 4 10 8.48 10 14c0 8.5 10 22 10 22s10-13.5 10-22c0-5.52-4.48-10-10-10z" fill="url(#pinGrad)"/>
                <circle cx="20" cy="13.5" r="3.5" fill="rgba(5,12,8,0.85)"/>
              </g>
            </svg>
          </div>
          <span className={styles.navLogoText}>Gravity</span>
        </a>

        <ul className={styles.navLinks}>
          <li><a href="#features">Features</a></li>
          <li><a href="#how">How it works</a></li>
          <li><a href="#download">Download</a></li>
          <li><Link to="/parent">For Parents</Link></li>
          <li><Link to="/child">For Children</Link></li>
          <li><Link to="/login?redirect=/parent/panel">Parent Panel</Link></li>
          <li><Link to="/login?redirect=/child/panel">Child Panel</Link></li>
        </ul>

        <a href="#download" className={`${styles.navCta} ${styles.desktopOnly}`}>Get the App</a>

        <label htmlFor="nav-toggle" className={styles.hamburgerLabel}>
          <span></span>
          <span></span>
          <span></span>
        </label>
      </nav>

      <div className={`${styles.navMobileMenu}${mobileMenuOpen ? ' ' + styles.navMobileMenuOpen : ''}`}>
        <a href="#features" onClick={() => setMobileMenuOpen(false)}>Features</a>
        <a href="#how" onClick={() => setMobileMenuOpen(false)}>How it works</a>
        <a href="#download" onClick={() => setMobileMenuOpen(false)}>Download</a>
        <Link to="/parent" onClick={() => setMobileMenuOpen(false)}>For Parents</Link>
        <Link to="/child" onClick={() => setMobileMenuOpen(false)}>For Children</Link>
        <Link to="/login?redirect=/parent/panel" onClick={() => setMobileMenuOpen(false)}>Parent Panel</Link>
        <Link to="/login?redirect=/child/panel" onClick={() => setMobileMenuOpen(false)}>Child Panel</Link>
        <a href="#download" className={styles.navCta} onClick={() => setMobileMenuOpen(false)}>Get the App</a>
      </div>

      {/* ===== HERO ===== */}
      <section className={styles.hero} id="hero">
        <canvas ref={canvasRef} className={styles.heroCanvas} id="heroCanvas" />

        <div className={styles.heroLeft}>
          <div className={styles.heroBadgeLive}>
            <span className={styles.liveDot}></span>
            Live Location Sharing — Always On
          </div>

          <h1 className={styles.heroHeadline}>
            <span className={styles.headlineLine1}>Keep Your Family</span>
            <span className={styles.headlineLine2}>Safe &amp; Connected</span>
          </h1>

          <p className={styles.heroSub}>Real-time location sharing, geofencing, and instant alerts — designed for families across Kenya, India, UAE, UK &amp; USA.</p>

          <div className={styles.heroBtns}>
            <a className={styles.btnPrimaryHero} href="#download">📱 Download Free</a>
            <a className={styles.btnSecondaryHero} href="#features">→ See Features</a>
          </div>

          <div className={styles.panelLinks}>
            <Link to="/login?redirect=/parent/panel" className={styles.panelLink}>Parent Panel →</Link>
            <Link to="/login?redirect=/child/panel" className={styles.panelLink}>Child Panel →</Link>
          </div>

          <div className={styles.familyStrip}>
            <div className={styles.familyStripLabel}>Your family, all in one place</div>
            <div className={styles.familyAvatarsRow}>
              <div className={`${styles.familyAvatar} ${styles.avatarMom}`}>
                <div className={styles.familyAvatarImgWrapper}>
                  <img src="https://picsum.photos/seed/woman-mom/64/64" alt="Mom" loading="lazy" />
                  <span className={`${styles.avatarStatusDot} ${styles.green}`}></span>
                </div>
                <div className={styles.avatarName}>Mom</div>
                <div className={styles.avatarTooltip}>
                  <span className={styles.tooltipName}>Mom</span>
                  <span className={styles.tooltipStatus}>Online · Active now</span>
                </div>
              </div>
              <div className={`${styles.familyAvatar} ${styles.avatarDad}`}>
                <div className={styles.familyAvatarImgWrapper}>
                  <img src="https://picsum.photos/seed/man-dad/64/64" alt="Dad" loading="lazy" />
                  <span className={`${styles.avatarStatusDot} ${styles.green}`}></span>
                </div>
                <div className={styles.avatarName}>Dad</div>
                <div className={styles.avatarTooltip}>
                  <span className={styles.tooltipName}>Dad</span>
                  <span className={styles.tooltipStatus}>Online · Active now</span>
                </div>
              </div>
              <div className={`${styles.familyAvatar} ${styles.avatarRahul}`}>
                <div className={styles.familyAvatarImgWrapper}>
                  <img src="https://picsum.photos/seed/boy-rahul/64/64" alt="Rahul" loading="lazy" />
                  <span className={`${styles.avatarStatusDot} ${styles.green}`}></span>
                </div>
                <div className={styles.avatarName}>Rahul</div>
                <div className={styles.avatarTooltip}>
                  <span className={styles.tooltipName}>Rahul</span>
                  <span className={styles.tooltipStatus}>Online · Active now</span>
                </div>
              </div>
              <div className={`${styles.familyAvatar} ${styles.avatarPinky}`}>
                <div className={styles.familyAvatarImgWrapper}>
                  <img src="https://picsum.photos/seed/girl-pinky/64/64" alt="Pinky" loading="lazy" />
                  <span className={`${styles.avatarStatusDot} ${styles.yellow}`}></span>
                </div>
                <div className={styles.avatarName}>Pinky</div>
                <div className={styles.avatarTooltip}>
                  <span className={styles.tooltipName}>Pinky</span>
                  <span className={styles.tooltipStatus}>Idle · 12 min ago</span>
                </div>
              </div>
              <div className={`${styles.familyAvatar} ${styles.avatarGrandpa}`}>
                <div className={styles.familyAvatarImgWrapper}>
                  <img src="https://picsum.photos/seed/oldman-gp/64/64" alt="Grand Pa" loading="lazy" />
                  <span className={`${styles.avatarStatusDot} ${styles.green}`}></span>
                </div>
                <div className={styles.avatarName}>Grand Pa</div>
                <div className={styles.avatarTooltip}>
                  <span className={styles.tooltipName}>Grand Pa</span>
                  <span className={styles.tooltipStatus}>Online · Active now</span>
                </div>
              </div>
              <div className={`${styles.familyAvatar} ${styles.avatarGrandmom}`}>
                <div className={styles.familyAvatarImgWrapper}>
                  <img src="https://picsum.photos/seed/woman-gm/64/64" alt="Grand Mom" loading="lazy" />
                  <span className={`${styles.avatarStatusDot} ${styles.grey}`}></span>
                </div>
                <div className={styles.avatarName}>Grand Mom</div>
                <div className={styles.avatarTooltip}>
                  <span className={styles.tooltipName}>Grand Mom</span>
                  <span className={styles.tooltipStatus}>Offline · 2 hr ago</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className={styles.heroRight}>
          <div className={styles.mapDemoHeader}>
            <div className={styles.liveDemoBadge}><span className={styles.blinkDot}></span>LIVE DEMO</div>
            <h3 className={styles.mapDemoTitle}>See Your Family<br /><span>On One Map</span></h3>
            <p className={styles.mapDemoSub}>Real-time location, battery status — all on a live map.</p>
          </div>

          <div className={styles.mapWrap}>
            <div ref={mapRef} style={{ width: '100%', height: '100%', minHeight: '420px' }} />

            <div className={styles.indexMapSwitcher}>
              {(['dark', 'light', 'satellite', 'street'] as const).map(type => (
                <button
                  key={type}
                  onClick={() => switchMap(type)}
                  className={`${styles.imbBtn}${activeMapType === type ? ' ' + styles.active : ''}`}
                >
                  <span style={{ fontSize: '15px', display: 'block', marginBottom: '2px' }}>
                    {type === 'dark' ? '🌙' : type === 'light' ? '☀️' : type === 'satellite' ? '🛰️' : '🗺️'}
                  </span>
                  {type === 'dark' ? 'Dark' : type === 'light' ? 'Light' : type === 'satellite' ? 'Sat' : 'Street'}
                </button>
              ))}
            </div>

            <div className={styles.zoomControls}>
              <button onClick={() => mapZoom(1)} className={styles.zoomBtn}>+</button>
              <button onClick={() => mapZoom(-1)} className={styles.zoomBtn}>−</button>
            </div>

            <div className={styles.mapLiveTag}>
              <span className={styles.pulseDotSm}></span>
              GRAVITY LIVE <span className={styles.memberCount}>6 online</span>
            </div>

            {/* Toggle tab — always visible at right edge, moves with sidebar */}
            <button
              className={`${styles.sidebarToggle} ${sidebarOpen ? styles.sidebarToggleOpen : ''}`}
              onClick={() => setSidebarOpen(o => !o)}
              aria-label={sidebarOpen ? 'Close panel' : 'Open panel'}
            >
              {sidebarOpen ? '›' : '‹'}
            </button>

            <div className={`${styles.mapSidebar} ${sidebarOpen ? styles.mapSidebarOpen : ''}`}>
              <div className={styles.sidebarTitle}>
                <span className={styles.safeIcon}>✓</span> All 6 members safe
              </div>
              <div className={styles.sidebarSection}>
                <div className={styles.sidebarLabel}>LAST SOS</div>
                <div className={styles.sidebarValue}>None today ✓</div>
              </div>
              <div className={styles.sidebarSection}>
                <div className={styles.sidebarLabel}>JOURNEY</div>
                <div className={styles.sidebarValue}>Dad: 2.4 km from home</div>
              </div>
              <div className={styles.sidebarSection}>
                <div className={styles.sidebarLabel}>BATTERY</div>
                <div className={styles.batteryRow}><img src="https://picsum.photos/seed/woman-mom/20/20" className={styles.batAvatar} alt="" /><div className={styles.batBar}><div className={styles.batFill} style={{ width: '87%', background: '#00E676' }}></div></div><span className={styles.batPct}>87%</span></div>
                <div className={styles.batteryRow}><img src="https://picsum.photos/seed/man-dad/20/20" className={styles.batAvatar} alt="" /><div className={styles.batBar}><div className={styles.batFill} style={{ width: '64%', background: '#FFB300' }}></div></div><span className={styles.batPct}>64%</span></div>
                <div className={styles.batteryRow}><img src="https://picsum.photos/seed/boy-rahul/20/20" className={styles.batAvatar} alt="" /><div className={styles.batBar}><div className={styles.batFill} style={{ width: '92%', background: '#00E676' }}></div></div><span className={styles.batPct}>92%</span></div>
                <div className={styles.batteryRow}><img src="https://picsum.photos/seed/girl-pinky/20/20" className={styles.batAvatar} alt="" /><div className={styles.batBar}><div className={styles.batFill} style={{ width: '45%', background: '#FF7043' }}></div></div><span className={styles.batPct}>45%</span></div>
                <div className={styles.batteryRow}><img src="https://picsum.photos/seed/oldman-gp/20/20" className={styles.batAvatar} alt="" /><div className={styles.batBar}><div className={styles.batFill} style={{ width: '78%', background: '#00C853' }}></div></div><span className={styles.batPct}>78%</span></div>
                <div className={styles.batteryRow}><img src="https://picsum.photos/seed/woman-gm/20/20" className={styles.batAvatar} alt="" /><div className={styles.batBar}><div className={styles.batFill} style={{ width: '55%', background: '#FFB300' }}></div></div><span className={styles.batPct}>55%</span></div>
              </div>
              <button className={styles.openDashboardBtn}>Open Full Dashboard →</button>
            </div>
          </div>

          <div className={styles.memberStrip}>
            <div className={`${styles.memberChip} ${styles.active}`}>
              <img src="https://picsum.photos/seed/woman-mom/40/40" className={styles.memberPhoto} alt="" />
              <div className={styles.memberInfo}><span className={styles.memberName}>Mom</span><span className={`${styles.memberStatus} ${styles.online}`}>● Home • 2min</span></div>
            </div>
            <div className={styles.memberChip}>
              <img src="https://picsum.photos/seed/man-dad/40/40" className={styles.memberPhoto} alt="" />
              <div className={styles.memberInfo}><span className={styles.memberName}>Dad</span><span className={`${styles.memberStatus} ${styles.online}`}>● Office • 4min</span></div>
            </div>
            <div className={styles.memberChip}>
              <img src="https://picsum.photos/seed/boy-rahul/40/40" className={styles.memberPhoto} alt="" />
              <div className={styles.memberInfo}><span className={styles.memberName}>Rahul</span><span className={`${styles.memberStatus} ${styles.online}`}>● College • 1min</span></div>
            </div>
            <div className={styles.memberChip}>
              <img src="https://picsum.photos/seed/girl-pinky/40/40" className={styles.memberPhoto} alt="" />
              <div className={styles.memberInfo}><span className={styles.memberName}>Pinky</span><span className={`${styles.memberStatus} ${styles.idle}`}>● Street • 8min</span></div>
            </div>
            <div className={styles.memberChip}>
              <img src="https://picsum.photos/seed/oldman-gp/40/40" className={styles.memberPhoto} alt="" />
              <div className={styles.memberInfo}><span className={styles.memberName}>Grand Pa</span><span className={`${styles.memberStatus} ${styles.online}`}>● Park • 3min</span></div>
            </div>
            <div className={styles.memberChip}>
              <img src="https://picsum.photos/seed/woman-gm/40/40" className={styles.memberPhoto} alt="" />
              <div className={styles.memberInfo}><span className={styles.memberName}>Grand Mom</span><span className={`${styles.memberStatus} ${styles.offline}`}>● Home • 22min</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== PAIN POINT ===== */}
      <section id="pain" className={styles.painSection}>
        <span className={styles.sectionLabel}>The Problem</span>
        <h2 className={styles.sectionTitle}>Do you ever feel this way?</h2>
        <p className={styles.sectionSubtitle}>Every parent and family faces these fears — Gravity is the answer.</p>
        <div className={styles.painGrid}>
          <div className={`${styles.painCard} ${styles.revealUp}`}>
            <span className={styles.painEmoji}>😰</span>
            <div className={styles.painHeading}>&quot;My child is late from school and won&apos;t pick up the phone&quot;</div>
            <p className={styles.painText}>Every minute feels like an hour. No update, no location — just anxiety building up.</p>
          </div>
          <div className={`${styles.painCard} ${styles.revealUp}`} style={{ transitionDelay: '0.1s' }}>
            <span className={styles.painEmoji}>🚨</span>
            <div className={styles.painHeading}>&quot;How do I alert my family in an emergency?&quot;</div>
            <p className={styles.painText}>An accident, getting lost, feeling unsafe — and you feel helpless because there&apos;s no system in place.</p>
          </div>
          <div className={`${styles.painCard} ${styles.revealUp}`} style={{ transitionDelay: '0.2s' }}>
            <span className={styles.painEmoji}>🔋</span>
            <div className={styles.painHeading}>&quot;Other apps drain the battery — so everyone uninstalls them&quot;</div>
            <p className={styles.painText}>Heavy location apps don&apos;t last a day on a single charge. So the family ends up deleting them.</p>
          </div>
        </div>
        <div className={`${styles.painSolution} ${styles.revealUp}`}>
          <p className={styles.painSolutionText}>Gravity solves all three problems <span>in one app</span> — battery-friendly, real-time, and built for the whole family.</p>
        </div>
      </section>

      {/* ===== FEATURES ===== */}
      <section id="features" className={styles.featuresSection}>
        <div className={styles.featuresInner}>
          <p className={styles.featuresLabel}>Features</p>
          <h2 className={styles.featuresTitle}>Everything your family needs</h2>
          <p className={styles.featuresSubtitle}>One app to see where everyone is, get instant alerts, and keep the whole family connected — always.</p>

          <div className={styles.featuresGrid}>
            {/* 1. Live Location */}
            <div className={`${styles.fc2Card} ${styles.fc2CardLocation}`}>
              <div className={styles.fc2Illus}>
                <svg viewBox="0 0 150 150" fill="none">
                  <defs>
                    <filter id="locGlowF"><feGaussianBlur stdDeviation="2.5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                    <radialGradient id="famDot1Grad" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#00E676" stopOpacity="0.9"/>
                      <stop offset="100%" stopColor="#00A040" stopOpacity="0.3"/>
                    </radialGradient>
                    <radialGradient id="famDot2Grad" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#FFD740" stopOpacity="0.9"/>
                      <stop offset="100%" stopColor="#FFA000" stopOpacity="0.3"/>
                    </radialGradient>
                  </defs>
                  {/* Map grid background */}
                  <line x1="0" y1="50" x2="150" y2="50" stroke="rgba(0,230,118,0.07)" strokeWidth="1"/>
                  <line x1="0" y1="100" x2="150" y2="100" stroke="rgba(0,230,118,0.07)" strokeWidth="1"/>
                  <line x1="50" y1="0" x2="50" y2="150" stroke="rgba(0,230,118,0.07)" strokeWidth="1"/>
                  <line x1="100" y1="0" x2="100" y2="150" stroke="rgba(0,230,118,0.07)" strokeWidth="1"/>
                  {/* Trail path — diagonal from bottom-left up to top-right */}
                  <path d="M12,135 C25,100 52,110 72,82 C90,58 96,42 134,18" stroke="#00E676" strokeWidth="2" fill="none" className={styles.fc2Trail}/>
                  {/* Start point */}
                  <circle cx="12" cy="135" r="3.5" fill="rgba(0,200,83,0.3)" stroke="#00E676" strokeWidth="1.2"/>
                  {/* Moving dot going along trail */}
                  <circle className={styles.fc2MovingDot} r="5.5" fill="#00E676" filter="url(#locGlowF)"/>
                  {/* Destination pin at top-right */}
                  <path d="M134,18 C130,8 122,4 134,-2 C146,-6 149,8 144,15 C140,20 134,18 134,18Z" fill="#00E676" opacity="0.95" filter="url(#locGlowF)"/>
                  <circle cx="134" cy="18" r="4.5" fill="none" stroke="#00E676" strokeWidth="1.5" className={styles.fc2Ping1}/>
                  <circle cx="134" cy="18" r="4.5" fill="none" stroke="#00E676" strokeWidth="1.5" className={styles.fc2Ping2}/>
                  {/* Family dot 1 — green */}
                  <g className={styles.fc2FamDot1}>
                    <circle cx="28" cy="110" r="9" fill="url(#famDot1Grad)" filter="url(#locGlowF)"/>
                    <circle cx="28" cy="107" r="3.5" fill="#fff" opacity="0.9"/>
                    <path d="M21,118 Q24.5,113 28,113 Q31.5,113 35,118" fill="#fff" opacity="0.7"/>
                  </g>
                  {/* Family dot 2 — yellow */}
                  <g className={styles.fc2FamDot2}>
                    <circle cx="72" cy="82" r="8" fill="url(#famDot2Grad)" filter="url(#locGlowF)"/>
                    <circle cx="72" cy="79.5" r="3" fill="#fff" opacity="0.9"/>
                    <path d="M66,88 Q69,83.5 72,83.5 Q75,83.5 78,88" fill="#fff" opacity="0.7"/>
                  </g>
                  {/* LIVE badge */}
                  <rect x="5" y="5" width="52" height="17" rx="8" fill="rgba(0,0,0,0.55)" stroke="rgba(0,230,118,0.4)" strokeWidth="1"/>
                  <circle cx="17" cy="13.5" r="3.5" fill="#00E676" className={styles.fc2LivePulse}/>
                  <text x="25" y="17.5" fill="#00E676" fontSize="8" fontWeight="700" fontFamily="sans-serif" letterSpacing="1">LIVE</text>
                </svg>
              </div>
              <div className={`${styles.fc2IconBox} ${styles.fc2IconBoxGreen}`}>
                <svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
              </div>
              <h3 className={styles.fc2Title}>Live Location Sharing</h3>
              <p className={styles.fc2Desc}>See your family on a live map. Updates every few seconds using battery-smart background GPS.</p>
              <a className={styles.fc2Arrow} href="#download">→</a>
            </div>

            {/* 2. Safe Zones */}
            <div className={`${styles.fc2Card} ${styles.fc2CardGeo}`}>
              <div className={styles.fc2Illus}>
                <svg viewBox="0 0 150 150" fill="none">
                  <defs>
                    <filter id="geoGlowF"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                    <filter id="geoOrbitGlow"><feGaussianBlur stdDeviation="5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                    <radialGradient id="geoHouseGrad" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#93C5FD" stopOpacity="0.4"/>
                      <stop offset="100%" stopColor="#2563EB" stopOpacity="0.05"/>
                    </radialGradient>
                  </defs>
                  {/* Pulsing background glow ring */}
                  <circle cx="75" cy="75" r="64" stroke="rgba(147,197,253,0.2)" strokeWidth="1.5" className={styles.fc2GeoPulseRing}/>
                  {/* Inner ring */}
                  <circle cx="75" cy="75" r="38" stroke="rgba(147,197,253,0.3)" strokeWidth="1" strokeDasharray="5 8" fill="none"/>
                  {/* Orbit ring — BRIGHT blue */}
                  <g style={{ transformOrigin: '75px 75px' }} className={styles.fc2GeoSpin}>
                    <circle cx="75" cy="75" r="52" stroke="#93C5FD" strokeWidth="2" strokeDasharray="10 6" fill="none" opacity="0.85"/>
                    {/* Glowing comet dot — VERY BRIGHT white-blue */}
                    <circle cx="75" cy="23" r="11" fill="#3B82F6" filter="url(#geoOrbitGlow)" opacity="0.7"/>
                    <circle cx="75" cy="23" r="8" fill="#93C5FD" opacity="0.95"/>
                    <circle cx="75" cy="20" r="4.5" fill="#fff" opacity="1"/>
                    <path d="M67,31 Q71,26 75,26 Q79,26 83,31" fill="#fff" opacity="0.9"/>
                  </g>
                  {/* Center glow */}
                  <circle cx="75" cy="75" r="24" fill="url(#geoHouseGrad)" filter="url(#geoGlowF)"/>
                  {/* House at center — bright */}
                  <g transform="translate(75,75)" fill="#93C5FD" filter="url(#geoGlowF)">
                    <path d="M0,-20 L-18,0 L-12,0 L-12,16 L12,16 L12,0 L18,0 Z"/>
                    <rect x="-6" y="5" width="12" height="11" fill="#060f1e" rx="1"/>
                  </g>
                  {/* Entry alert dot */}
                  <circle cx="130" cy="130" r="5" fill="#60A5FA" className={styles.fc2GeoEntry} filter="url(#geoGlowF)"/>
                  {/* Badge */}
                  <rect x="104" y="5" width="41" height="17" rx="8" fill="rgba(59,130,246,0.25)" stroke="rgba(147,197,253,0.7)" strokeWidth="1"/>
                  <text x="125" y="17" fill="#93C5FD" fontSize="9" fontWeight="800" fontFamily="sans-serif" textAnchor="middle">+IN</text>
                </svg>
              </div>
              <div className={`${styles.fc2IconBox} ${styles.fc2IconBoxBlue}`}>
                <svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
              </div>
              <h3 className={styles.fc2Title}>Safe Zones &amp; Geofencing</h3>
              <p className={styles.fc2Desc}>Draw custom zones around home, school, or work. Get push notifications the moment anyone enters or leaves.</p>
              <a className={styles.fc2Arrow} href="#download">→</a>
            </div>

            {/* 3. Family Circles */}
            <div className={`${styles.fc2Card} ${styles.fc2CardFamily}`}>
              <div className={styles.fc2Illus}>
                <svg viewBox="0 0 150 150" fill="none">
                  <defs>
                    <filter id="famGlowF"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                  </defs>
                  {/* Connection lines — BRIGHT */}
                  <line x1="75" y1="48" x2="38" y2="112" stroke="#C4B5FD" strokeWidth="2" opacity="0.75" className={styles.fc2ConnLine}/>
                  <line x1="75" y1="48" x2="112" y2="112" stroke="#C4B5FD" strokeWidth="2" opacity="0.75" className={styles.fc2ConnLine}/>
                  <line x1="38" y1="112" x2="112" y2="112" stroke="#C4B5FD" strokeWidth="1.5" opacity="0.5" className={styles.fc2ConnLine}/>
                  {/* Animated pulse dots on lines */}
                  <circle cx="57" cy="80" r="3.5" fill="#DDD6FE" opacity="0.9" className={styles.fc2FamDot1}/>
                  <circle cx="93" cy="80" r="3.5" fill="#DDD6FE" opacity="0.9" className={styles.fc2FamDot2}/>
                  {/* Avatar A — top (brightest) */}
                  <g className={styles.fc2FamA} filter="url(#famGlowF)">
                    <circle cx="75" cy="36" r="22" fill="rgba(139,92,246,0.5)"/>
                    <circle cx="75" cy="36" r="20" stroke="#DDD6FE" strokeWidth="1.5" fill="none" opacity="0.7"/>
                    <circle cx="75" cy="32" r="9" fill="#DDD6FE"/>
                    <path d="M59,50 Q63,44 75,44 Q87,44 91,50" fill="#DDD6FE" opacity="0.9"/>
                  </g>
                  {/* Avatar B — bottom left */}
                  <g className={styles.fc2FamB} filter="url(#famGlowF)">
                    <circle cx="38" cy="110" r="18" fill="rgba(109,40,217,0.45)"/>
                    <circle cx="38" cy="110" r="16" stroke="#C4B5FD" strokeWidth="1.5" fill="none" opacity="0.65"/>
                    <circle cx="38" cy="106" r="7.5" fill="#C4B5FD" opacity="0.95"/>
                    <path d="M26,120 Q31,114 38,114 Q45,114 50,120" fill="#C4B5FD" opacity="0.85"/>
                  </g>
                  {/* Avatar C — bottom right */}
                  <g className={styles.fc2FamC} filter="url(#famGlowF)">
                    <circle cx="112" cy="110" r="18" fill="rgba(109,40,217,0.45)"/>
                    <circle cx="112" cy="110" r="16" stroke="#C4B5FD" strokeWidth="1.5" fill="none" opacity="0.65"/>
                    <circle cx="112" cy="106" r="7.5" fill="#C4B5FD" opacity="0.95"/>
                    <path d="M100,120 Q105,114 112,114 Q119,114 124,120" fill="#C4B5FD" opacity="0.85"/>
                  </g>
                  {/* CIRCLE badge */}
                  <rect x="38" y="5" width="74" height="16" rx="8" fill="rgba(139,92,246,0.3)" stroke="rgba(196,181,253,0.7)" strokeWidth="1"/>
                  <text x="75" y="16.5" fill="#DDD6FE" fontSize="7.5" fontWeight="800" fontFamily="sans-serif" textAnchor="middle" letterSpacing="1.5">CIRCLE</text>
                </svg>
              </div>
              <div className={`${styles.fc2IconBox} ${styles.fc2IconBoxPurple}`}>
                <svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
              </div>
              <h3 className={styles.fc2Title}>Family Circles</h3>
              <p className={styles.fc2Desc}>Private groups with a simple invite code. No email needed — just a phone number to join.</p>
              <a className={styles.fc2Arrow} href="#download">→</a>
            </div>

            {/* 4. SOS */}
            <div className={`${styles.fc2Card} ${styles.fc2CardSos2}`}>
              <div className={styles.fc2Illus}>
                <svg viewBox="0 0 150 150" fill="none">
                  <defs>
                    <filter id="sosGlowF"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                    <radialGradient id="sosBtnGrad" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#FF6B6B"/>
                      <stop offset="100%" stopColor="#B91C1C"/>
                    </radialGradient>
                  </defs>
                  {/* 3 expanding ping rings — BRIGHT near-white so visible on dark red */}
                  <circle cx="75" cy="75" r="16" fill="none" stroke="rgba(255,220,220,0.95)" strokeWidth="2.5" className={styles.fc2SosR1}/>
                  <circle cx="75" cy="75" r="16" fill="none" stroke="rgba(255,180,180,0.8)" strokeWidth="2" className={styles.fc2SosR2}/>
                  <circle cx="75" cy="75" r="16" fill="none" stroke="rgba(255,140,140,0.65)" strokeWidth="1.5" className={styles.fc2SosR3}/>
                  {/* Background glow */}
                  <circle cx="75" cy="75" r="40" fill="rgba(255,82,82,0.18)" filter="url(#sosGlowF)"/>
                  {/* SOS button — scale pulses with warning triangle inside */}
                  <g className={styles.fc2SosBtn}>
                    <circle cx="75" cy="75" r="28" fill="url(#sosBtnGrad)" filter="url(#sosGlowF)"/>
                    {/* Warning triangle */}
                    <path d="M75,56 L91,84 L59,84 Z" fill="rgba(255,255,255,0.9)" strokeLinejoin="round"/>
                    <rect x="72.5" y="64" width="5" height="11" rx="2.5" fill="#B91C1C"/>
                    <circle cx="75" cy="79" r="2.5" fill="#B91C1C"/>
                  </g>
                  {/* SOS label badge */}
                  <rect x="52" y="114" width="46" height="17" rx="8" fill="rgba(255,82,82,0.18)" stroke="rgba(255,82,82,0.5)" strokeWidth="1"/>
                  <text x="75" y="126.5" fill="#FF6B6B" fontSize="9" fontWeight="800" fontFamily="sans-serif" textAnchor="middle" letterSpacing="2">SOS</text>
                </svg>
              </div>
              <div className={`${styles.fc2IconBox} ${styles.fc2IconBoxRed}`}>
                <svg viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
              </div>
              <h3 className={styles.fc2Title}>SOS Panic Button</h3>
              <p className={styles.fc2Desc}>One tap sends your exact coordinates to every circle member instantly. 24/7 emergency alert.</p>
              <a className={styles.fc2Arrow} href="#download">→</a>
            </div>

            {/* 5. Battery */}
            <div className={`${styles.fc2Card} ${styles.fc2CardBattery}`}>
              <div className={styles.fc2Illus}>
                <svg viewBox="0 0 150 150" fill="none">
                  <defs>
                    <clipPath id="battClip"><rect x="54" y="16" width="32" height="78" rx="4"/></clipPath>
                    <filter id="battGlowF"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                    <linearGradient id="battGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#69F0AE"/>
                      <stop offset="60%" stopColor="#00E676"/>
                      <stop offset="100%" stopColor="#00A040"/>
                    </linearGradient>
                  </defs>
                  {/* Battery outer glow */}
                  <rect x="50" y="12" width="40" height="86" rx="7" fill="rgba(0,230,118,0.08)" filter="url(#battGlowF)" className={styles.fc2BattBolt}/>
                  {/* Battery body */}
                  <rect x="52" y="14" width="36" height="82" rx="6" stroke="#00E676" strokeWidth="2.5" fill="rgba(3,12,6,0.85)"/>
                  {/* Battery tip */}
                  <rect x="63" y="6" width="14" height="10" rx="3" fill="#00E676"/>
                  {/* Battery fill — animates from bottom upward, BRIGHT neon green */}
                  <rect className={styles.fc2BattFill} x="54" y="16" width="32" height="78" rx="4" fill="url(#battGrad)" clipPath="url(#battClip)"/>
                  {/* Bright top-edge "charge bar" — shows progress clearly */}
                  <rect x="54" y="16" width="32" height="3" rx="1.5" fill="#B9F6CA" opacity="0.5"/>
                  {/* Lightning bolt — WHITE so visible on green fill */}
                  <path d="M81,28 L66,58 L74,58 L67,96 L84,60 L76,60 Z" fill="rgba(255,255,255,0.85)"/>
                  {/* Bright sparks flying out */}
                  <circle className={styles.fc2Spark1} cx="98" cy="90" r="5" fill="#86EFAC"/>
                  <circle className={styles.fc2Spark2} cx="105" cy="64" r="4" fill="#4ADE80"/>
                  <circle className={styles.fc2Spark3} cx="99" cy="40" r="4.5" fill="#86EFAC"/>
                  <circle className={styles.fc2Spark4} cx="107" cy="52" r="3" fill="#D1FAE5"/>
                  {/* Leaf energy particles */}
                  <g className={styles.fc2Leaf1}><ellipse cx="118" cy="104" rx="5.5" ry="9" fill="#4ADE80" opacity="0.7" transform="rotate(-30,118,104)"/></g>
                  <g className={styles.fc2Leaf2}><ellipse cx="128" cy="78" rx="4.5" ry="7" fill="#86EFAC" opacity="0.6" transform="rotate(20,128,78)"/></g>
                  <g className={styles.fc2Leaf3}><ellipse cx="123" cy="53" rx="4" ry="6.5" fill="#BBF7D0" opacity="0.55" transform="rotate(10,123,53)"/></g>
                  {/* Charging badge */}
                  <rect x="36" y="107" width="68" height="17" rx="8" fill="rgba(0,200,83,0.2)" stroke="rgba(134,239,172,0.6)" strokeWidth="1"/>
                  <text x="70" y="119.5" fill="#86EFAC" fontSize="8.5" fontWeight="700" fontFamily="sans-serif" textAnchor="middle" className={styles.fc2BattPct}>CHARGING...</text>
                </svg>
              </div>
              <div className={`${styles.fc2IconBox} ${styles.fc2IconBoxGreen}`}>
                <svg viewBox="0 0 24 24"><path d="M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4zM13 18h-2v-2h2v2zm0-4h-2V9h2v5z"/></svg>
              </div>
              <h3 className={styles.fc2Title}>Battery Optimized</h3>
              <p className={styles.fc2Desc}>Smart Significant Location Change APIs mean you can track all day without draining anyone&apos;s battery.</p>
              <a className={styles.fc2Arrow} href="#download">→</a>
            </div>

            {/* 6. Privacy */}
            <div className={`${styles.fc2Card} ${styles.fc2CardPrivacy}`}>
              <div className={styles.fc2Illus}>
                <svg viewBox="0 0 150 150" fill="none">
                  <defs>
                    <filter id="shieldGlow"><feGaussianBlur stdDeviation="3.5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                    <clipPath id="shieldClip">
                      <path d="M75,15 L35,30 L35,68 C35,92 53,112 75,120 C97,112 115,92 115,68 L115,30 Z"/>
                    </clipPath>
                  </defs>
                  {/* Floating lock icons — BRIGHT so visible on dark indigo */}
                  <g className={styles.fc2Pt1}>
                    <rect x="109" y="96" width="10" height="9" rx="2.5" fill="#A5B4FC"/>
                    <path d="M111,96 L111,92 A3,3 0 0 1 117,92 L117,96" stroke="#A5B4FC" strokeWidth="2" fill="none"/>
                  </g>
                  <g className={styles.fc2Pt2}>
                    <rect x="94" y="117" width="9" height="8" rx="2" fill="#818CF8"/>
                    <path d="M96,117 L96,113 A2.5,2.5 0 0 1 101,113 L101,117" stroke="#818CF8" strokeWidth="1.8" fill="none"/>
                  </g>
                  <g className={styles.fc2Pt3}>
                    <rect x="122" y="80" width="10" height="9" rx="2.5" fill="#A5B4FC"/>
                    <path d="M124,80 L124,76 A3,3 0 0 1 130,76 L130,80" stroke="#A5B4FC" strokeWidth="2" fill="none"/>
                  </g>
                  <circle cx="26" cy="55" r="3.5" fill="#818CF8" opacity="0.6" className={styles.fc2Pt4}/>
                  <circle cx="30" cy="98" r="3" fill="#A5B4FC" opacity="0.55" className={styles.fc2Pt5}/>
                  {/* Shield group — floats, VERY BRIGHT */}
                  <g className={styles.fc2ShieldGrp} filter="url(#shieldGlow)">
                    {/* Outer glow */}
                    <path d="M75,15 L35,30 L35,68 C35,92 53,112 75,120 C97,112 115,92 115,68 L115,30 Z" fill="rgba(99,102,241,0.08)" stroke="#A5B4FC" strokeWidth="2.5" strokeLinejoin="round"/>
                    {/* Inner fill */}
                    <path d="M75,20 L40,33 L40,68 C40,90 56,108 75,115 C94,108 110,90 110,68 L110,33 Z" fill="rgba(129,140,248,0.2)"/>
                    {/* Lock body — bright */}
                    <rect x="61" y="66" width="28" height="24" rx="5" fill="#A5B4FC"/>
                    {/* Lock shackle */}
                    <path d="M68,66 L68,58 A7,7 0 0 1 82,58 L82,66" stroke="#A5B4FC" strokeWidth="3.5" fill="none" strokeLinecap="round"/>
                    {/* Keyhole */}
                    <circle cx="75" cy="76" r="4.5" fill="#06091a"/>
                    <rect x="73" y="78" width="4" height="7" rx="1" fill="#06091a"/>
                    {/* Scan line — BRIGHT WHITE */}
                    <rect x="35" y="30" width="80" height="3" rx="1.5" fill="rgba(255,255,255,0.9)" className={styles.fc2ScanLine} clipPath="url(#shieldClip)"/>
                  </g>
                  {/* ENCRYPTED label */}
                  <rect x="30" y="128" width="90" height="16" rx="8" fill="rgba(79,70,229,0.25)" stroke="rgba(165,180,252,0.6)" strokeWidth="1"/>
                  <text x="75" y="139.5" fill="#C7D2FE" fontSize="7" fontWeight="800" fontFamily="sans-serif" textAnchor="middle" letterSpacing="1.5">ENCRYPTED</text>
                </svg>
              </div>
              <div className={`${styles.fc2IconBox} ${styles.fc2IconBoxIndigo}`}>
                <svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
              </div>
              <h3 className={styles.fc2Title}>Private &amp; Secure</h3>
              <p className={styles.fc2Desc}>End-to-end encrypted. Your location is only ever shared with your approved circle. Never sold.</p>
              <a className={styles.fc2Arrow} href="#download">→</a>
            </div>
          </div>
        </div>
      </section>

      {/* ===== APP SCREENSHOTS ===== */}
      <section id="screenshots" className={styles.screenshotsSection}>
        <span className={styles.sectionLabel}>Inside The App</span>
        <h2 className={styles.sectionTitle}>See Gravity<br />from the inside</h2>
        <p className={styles.sectionSubtitle}>Simple, clean, and powerful — designed for the whole family.</p>

        <div className={styles.screenshotsScroll}>
          {/* Live Map */}
          <div className={`${styles.screenshotCard} ${styles.revealUp}`}>
            <div className={styles.screenshotPhone}>
              <div className={styles.phStatus}>
                <span className={styles.phTime}>9:41</span>
                <div className={styles.phStatusRight}><div className={styles.phSig}><b></b><b></b><b></b><b></b></div><div className={styles.phBat}></div></div>
              </div>
              <div className={styles.phMapBg}>
                <div style={{ position: 'absolute', top: '44%', left: 0, right: 0, height: '7px', background: 'rgba(12,35,18,0.9)', borderTop: '1px solid rgba(0,230,118,0.07)', borderBottom: '1px solid rgba(0,230,118,0.07)' }}></div>
                <div style={{ position: 'absolute', top: '69%', left: 0, right: 0, height: '5px', background: 'rgba(10,28,14,0.8)' }}></div>
                <div style={{ position: 'absolute', left: '36%', top: 0, bottom: 0, width: '7px', background: 'rgba(12,35,18,0.9)', borderLeft: '1px solid rgba(0,230,118,0.07)', borderRight: '1px solid rgba(0,230,118,0.07)' }}></div>
                <div style={{ position: 'absolute', left: '65%', top: 0, bottom: 0, width: '5px', background: 'rgba(10,28,14,0.7)' }}></div>
                <div className={styles.phLiveBadge}><span className={styles.phLiveDot}></span>LIVE · 3 online</div>
                <div className={styles.phAvatarDot} style={{ '--dc': '#00E676', top: '30%', left: '15%', animation: 'phMapFloat1 4s ease-in-out infinite' } as React.CSSProperties}>
                  <div className={styles.phDotRing}></div><div className={styles.phDotInner}>👩</div>
                </div>
                <div className={styles.phAvatarDot} style={{ '--dc': '#FFB300', top: '54%', left: '57%', animation: 'phMapFloat2 5s ease-in-out infinite 0.5s' } as React.CSSProperties}>
                  <div className={styles.phDotRing} style={{ borderColor: '#FFB300' }}></div><div className={styles.phDotInner} style={{ borderColor: '#FFB300', boxShadow: '0 0 10px rgba(255,179,0,0.7)' }}>👦</div>
                </div>
                <div className={styles.phAvatarDot} style={{ '--dc': '#29B6F6', top: '20%', left: '62%', animation: 'phMapFloat3 3.5s ease-in-out infinite 1s' } as React.CSSProperties}>
                  <div className={styles.phDotRing} style={{ borderColor: '#29B6F6', animationDelay: '0.5s' }}></div><div className={styles.phDotInner} style={{ borderColor: '#29B6F6', boxShadow: '0 0 10px rgba(41,182,246,0.7)' }}>👨</div>
                </div>
                <div className={styles.phMapStrip}>
                  <div className={styles.phStripRow}><span className={styles.phStripDot} style={{ background: '#00E676' }}></span>Mom · Home</div>
                  <div className={styles.phStripRow}><span className={styles.phStripDot} style={{ background: '#FFB300' }}></span>Rahul · School</div>
                  <div className={styles.phStripRow}><span className={styles.phStripDot} style={{ background: '#29B6F6' }}></span>Dad · Office</div>
                </div>
              </div>
            </div>
            <div className={styles.screenshotTitle}>Live Family Map</div>
            <p className={styles.screenshotDesc}>See every member&apos;s real-time location on one map</p>
            <span className={styles.screenshotTag}>Always On</span>
          </div>

          {/* SOS Screen */}
          <div className={`${styles.screenshotCard} ${styles.revealUp}`} style={{ transitionDelay: '0.08s' }}>
            <div className={styles.screenshotPhone}>
              <div className={styles.phStatus}>
                <span className={styles.phTime} style={{ color: 'rgba(255,100,100,0.85)' }}>9:41</span>
                <div className={styles.phStatusRight}><div className={styles.phSig}><b></b><b></b><b></b><b></b></div><div className={styles.phBat}></div></div>
              </div>
              <div className={styles.phSosBg}>
                <div className={styles.phSosHeader}>🚨 Emergency</div>
                <div className={styles.phSosCenter}>
                  <div className={styles.phSosRing}></div>
                  <div className={styles.phSosRing}></div>
                  <div className={styles.phSosRing}></div>
                  <div className={styles.phSosBtn}>
                    <span className={styles.phSosTxt}>SOS</span>
                    <span className={styles.phSosSubTxt}>ALERT</span>
                  </div>
                </div>
                <div className={styles.phSosFooter}>
                  <div className={styles.phSosHoldTxt}>Hold 3 seconds</div>
                  <div className={styles.phSosCancelBtn}>CANCEL</div>
                </div>
              </div>
            </div>
            <div className={styles.screenshotTitle}>SOS Alert</div>
            <p className={styles.screenshotDesc}>Send an emergency alert to your whole family with 1 press</p>
            <span className={styles.screenshotTag} style={{ background: 'rgba(255,82,82,0.1)', color: '#FF5252', borderColor: 'rgba(255,82,82,0.25)' }}>Emergency</span>
          </div>

          {/* Geofence */}
          <div className={`${styles.screenshotCard} ${styles.revealUp}`} style={{ transitionDelay: '0.16s' }}>
            <div className={styles.screenshotPhone}>
              <div className={styles.phStatus}>
                <span className={styles.phTime}>9:41</span>
                <div className={styles.phStatusRight}><div className={styles.phSig}><b></b><b></b><b></b><b></b></div><div className={styles.phBat}></div></div>
              </div>
              <div className={styles.phGeoBg}>
                <div className={styles.phGeoLabel}>Safe Zones</div>
                <div className={styles.phGeoCenter}>
                  <div className={styles.phGeoOuterRing}>
                    <div className={styles.phGeoInnerRing}>🏠</div>
                  </div>
                </div>
                <div className={styles.phGeoNotif}>
                  <div className={styles.phGeoNotifIcon}>📍</div>
                  <div>
                    <div className={styles.phGeoNotifTitle}>✓ Arrived Home</div>
                    <div className={styles.phGeoNotifSub}>Pinky entered Home zone</div>
                  </div>
                </div>
              </div>
            </div>
            <div className={styles.screenshotTitle}>Safe Zones</div>
            <p className={styles.screenshotDesc}>Set zones for home and school — get alerts when anyone arrives or leaves</p>
            <span className={styles.screenshotTag}>Geofence</span>
          </div>

          {/* Battery Dashboard */}
          <div className={`${styles.screenshotCard} ${styles.revealUp}`} style={{ transitionDelay: '0.24s' }}>
            <div className={styles.screenshotPhone}>
              <div className={styles.phStatus}>
                <span className={styles.phTime}>9:41</span>
                <div className={styles.phStatusRight}><div className={styles.phSig}><b></b><b></b><b></b><b></b></div><div className={styles.phBat}></div></div>
              </div>
              <div className={styles.phBattscreenBg}>
                <div className={styles.phBattscreenTitle}>Battery <span>Status</span></div>
                <div className={styles.phBattscreenRows}>
                  <div className={styles.phBattRow}>
                    <div className={styles.phBattAva}>👩</div>
                    <div className={styles.phBattInfo}>
                      <div className={styles.phBattName}>Mom</div>
                      <div className={styles.phBattTrack}><div className={styles.phBattFillBar} style={{ '--pct': '87%', '--delay': '0.3s', background: '#00E676' } as React.CSSProperties}></div></div>
                    </div>
                    <div className={styles.phBattPctText} style={{ color: '#00E676' }}>87%</div>
                  </div>
                  <div className={styles.phBattRow}>
                    <div className={styles.phBattAva}>👨</div>
                    <div className={styles.phBattInfo}>
                      <div className={styles.phBattName}>Dad</div>
                      <div className={styles.phBattTrack}><div className={styles.phBattFillBar} style={{ '--pct': '64%', '--delay': '0.5s', background: '#00C853' } as React.CSSProperties}></div></div>
                    </div>
                    <div className={styles.phBattPctText} style={{ color: '#00C853' }}>64%</div>
                  </div>
                  <div className={styles.phBattRow}>
                    <div className={styles.phBattAva}>👦</div>
                    <div className={styles.phBattInfo}>
                      <div className={styles.phBattName}>Rahul</div>
                      <div className={styles.phBattTrack}><div className={styles.phBattFillBar} style={{ '--pct': '34%', '--delay': '0.7s', background: '#FFB300' } as React.CSSProperties}></div></div>
                    </div>
                    <div className={styles.phBattPctText} style={{ color: '#FFB300' }}>34%</div>
                  </div>
                  <div className={styles.phBattRow}>
                    <div className={styles.phBattAva}>👧</div>
                    <div className={styles.phBattInfo}>
                      <div className={styles.phBattName}>Pinky</div>
                      <div className={styles.phBattTrack}><div className={styles.phBattFillBar} style={{ '--pct': '12%', '--delay': '0.9s', background: '#FF5252' } as React.CSSProperties}></div></div>
                    </div>
                    <div className={styles.phBattPctText} style={{ color: '#FF5252' }}>12%</div>
                  </div>
                </div>
                <div className={styles.phBattscreenFooter}>
                  <div className={styles.phBattscreenBadge}>🔋 Pinky low — 12% left</div>
                </div>
              </div>
            </div>
            <div className={styles.screenshotTitle}>Battery Status</div>
            <p className={styles.screenshotDesc}>Monitor everyone&apos;s phone battery level in one place</p>
            <span className={styles.screenshotTag}>Pro Feature</span>
          </div>

          {/* Alerts */}
          <div className={`${styles.screenshotCard} ${styles.revealUp}`} style={{ transitionDelay: '0.32s' }}>
            <div className={styles.screenshotPhone}>
              <div className={styles.phStatus}>
                <span className={styles.phTime}>9:41</span>
                <div className={styles.phStatusRight}><div className={styles.phSig}><b></b><b></b><b></b><b></b></div><div className={styles.phBat}></div></div>
              </div>
              <div className={styles.phAlertsBg}>
                <div className={styles.phAlertsTitle}><span>4</span> New Alerts</div>
                <div className={styles.phAlertsList}>
                  <div className={`${styles.phAlertItem} ${styles.aGreen}`}>
                    <span className={styles.phAlertIco}>📍</span>
                    <div className={styles.phAlertBody}>
                      <div className={styles.phAlertTtl}>Arrived Home</div>
                      <div className={styles.phAlertDsc}>Pinky reached Home zone</div>
                      <div className={styles.phAlertAgo}>2 min ago</div>
                    </div>
                  </div>
                  <div className={`${styles.phAlertItem} ${styles.aRed}`}>
                    <span className={styles.phAlertIco}>🆘</span>
                    <div className={styles.phAlertBody}>
                      <div className={styles.phAlertTtl}>SOS Alert</div>
                      <div className={styles.phAlertDsc}>Rahul sent SOS</div>
                      <div className={styles.phAlertAgo}>5 min ago</div>
                    </div>
                  </div>
                  <div className={`${styles.phAlertItem} ${styles.aYellow}`}>
                    <span className={styles.phAlertIco}>🔋</span>
                    <div className={styles.phAlertBody}>
                      <div className={styles.phAlertTtl}>Low Battery</div>
                      <div className={styles.phAlertDsc}>Dad battery at 15%</div>
                      <div className={styles.phAlertAgo}>8 min ago</div>
                    </div>
                  </div>
                  <div className={`${styles.phAlertItem} ${styles.aBlue}`}>
                    <span className={styles.phAlertIco}>🏠</span>
                    <div className={styles.phAlertBody}>
                      <div className={styles.phAlertTtl}>Left School</div>
                      <div className={styles.phAlertDsc}>Rahul left School zone</div>
                      <div className={styles.phAlertAgo}>12 min ago</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className={styles.screenshotTitle}>Smart Alerts</div>
            <p className={styles.screenshotDesc}>Geofence, SOS, battery — all alerts in one place</p>
            <span className={styles.screenshotTag}>Real-time</span>
          </div>
        </div>

        <a href="#" className={`${styles.screenshotsTryBtn} ${styles.revealUp}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M1 6s2-2 5-2 5.5 2 8 2 5-2 5-2v14s-2 2-5 2-5.5-2-8-2-5 2-5 2z"/><line x1="1" y1="20" x2="1" y2="6"/></svg>
          Try Live Demo — Parent Panel
        </a>
      </section>

      {/* STATS BAR */}
      <div className={styles.statsBar}>
        <div className={styles.statsInner}>
          <div className={styles.statItem}>
            <span className={styles.statNumber} data-count="50000">50K+</span>
            <span className={styles.statLabel}>Families Protected</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statNumber} data-count="5">5</span>
            <span className={styles.statLabel}>Countries Supported</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statNumber} data-count="99">99.9%</span>
            <span className={styles.statLabel}>Service Uptime</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statNumber}>&lt;2s</span>
            <span className={styles.statLabel}>Location Updates</span>
          </div>
        </div>
      </div>

      {/* HOW IT WORKS */}
      <section id="how" className={styles.howSection}>
        <div className={styles.howHeader}>
          <span className={styles.howLabel}>How It Works</span>
          <h2 className={styles.howTitle}>Set up in 3 minutes</h2>
          <p className={styles.howSubtitle}>No complicated signup. Download, verify your number, and your family is connected.</p>
        </div>
        <div className={styles.timeline}>
          <div className={styles.step}>
            <div className={styles.stepContent}>
              <div className={styles.stepIcon}>📥</div>
              <h3 className={styles.stepTitle}>Download Gravity</h3>
              <p className={styles.stepDesc}>Free on Android and iOS. Find us on Google Play and App Store. 30 second install.</p>
            </div>
            <div className={styles.stepCircle}>1</div>
            <div className={styles.stepPlaceholder}></div>
          </div>
          <div className={styles.step}>
            <div className={styles.stepPlaceholder}></div>
            <div className={styles.stepCircle}>2</div>
            <div className={styles.stepContent}>
              <div className={styles.stepIcon}>📱</div>
              <h3 className={styles.stepTitle}>Verify Your Number</h3>
              <p className={styles.stepDesc}>Quick OTP verification. No email, no long forms. Just your phone number.</p>
            </div>
          </div>
          <div className={styles.step}>
            <div className={styles.stepContent}>
              <div className={styles.stepIcon}>👨‍👩‍👧‍👦</div>
              <h3 className={styles.stepTitle}>Create Your Circle</h3>
              <p className={styles.stepDesc}>Name your family group and get a unique invite code to share with your loved ones.</p>
            </div>
            <div className={styles.stepCircle}>3</div>
            <div className={styles.stepPlaceholder}></div>
          </div>
          <div className={styles.step}>
            <div className={styles.stepPlaceholder}></div>
            <div className={styles.stepCircle}>4</div>
            <div className={styles.stepContent}>
              <div className={styles.stepIcon}>🗺</div>
              <h3 className={styles.stepTitle}>See Everyone Live</h3>
              <p className={styles.stepDesc}>Your family joins in seconds. Open the map and see every member&apos;s location in real time.</p>
            </div>
          </div>
        </div>
      </section>

      {/* FOR PARENTS / FOR CHILDREN */}
      <section id="for-whom" className={styles.forWhomSection}>
        <span className={styles.sectionLabel}>Made For Everyone</span>
        <h2 className={styles.sectionTitle}>A different experience<br />for everyone</h2>
        <p className={styles.sectionSubtitle}>Both parents and children get their own tailored view on Gravity.</p>
        <div className={styles.forWhomGrid}>
          <div className={`${styles.forWhomCard} ${styles.parentCard} ${styles.revealUp}`}>
            <span className={styles.forWhomIcon}>👨‍👩‍👧</span>
            <div className={styles.forWhomRole}>For Parents</div>
            <h3 className={styles.forWhomHeading}>Your whole family<br />at a glance</h3>
            <p className={styles.forWhomDesc}>With Parent Panel, manage your entire family circle — location, alerts, and geofences all in one place.</p>
            <ul className={styles.forWhomFeatures}>
              <li><span className={styles.fwIcon}>📍</span>View everyone&apos;s live location on one map</li>
              <li><span className={styles.fwIcon}>🏠</span>Set safe zones for home and school</li>
              <li><span className={styles.fwIcon}>🚨</span>Receive SOS alerts instantly</li>
              <li><span className={styles.fwIcon}>🔋</span>Monitor everyone&apos;s phone battery</li>
              <li><span className={styles.fwIcon}>📋</span>30-day location history (Pro)</li>
              <li><span className={styles.fwIcon}>👥</span>Add or remove circle members</li>
            </ul>
            <Link to="/parent" className={`${styles.forWhomBtn} ${styles.parentBtn}`}>Try Parent Panel →</Link>
          </div>
          <div className={`${styles.forWhomCard} ${styles.childCard} ${styles.revealUp}`} style={{ transitionDelay: '0.12s' }}>
            <span className={styles.forWhomIcon}>👦</span>
            <div className={styles.forWhomRole}>For Children</div>
            <h3 className={styles.forWhomHeading}>Stay safe,<br />keep parents informed</h3>
            <p className={styles.forWhomDesc}>Child Panel is simple and fast — one SOS button, location sharing, and family status — that&apos;s all you need.</p>
            <ul className={styles.forWhomFeatures}>
              <li><span className={styles.fwIcon}>🆘</span>1-press SOS in an emergency</li>
              <li><span className={styles.fwIcon}>📍</span>Share your live location with family</li>
              <li><span className={styles.fwIcon}>✅</span>Send a quick &quot;I&apos;m Safe&quot; message</li>
              <li><span className={styles.fwIcon}>👀</span>See family members&apos; locations</li>
              <li><span className={styles.fwIcon}>🗺️</span>Family map access</li>
              <li><span className={styles.fwIcon}>🔒</span>Privacy controls in your hands</li>
            </ul>
            <Link to="/child" className={`${styles.forWhomBtn} ${styles.childBtn}`}>Try Child Panel →</Link>
          </div>
        </div>
      </section>

      {/* COUNTRIES */}
      <section id="countries" className={styles.countriesSection}>
        <span className={styles.sectionLabel}>Available In</span>
        <h2 className={styles.sectionTitle}>Trusted by families in 5 countries</h2>
        <p className={styles.sectionSubtitle}>Built for the unique needs of families whether you&apos;re in Nairobi, Mumbai, Dubai, London or New York.</p>
        <div className={styles.countriesGrid}>
          <div className={styles.countryCard}><span className={styles.countryFlag}>🇰🇪</span><div className={styles.countryInfo}><span className={styles.countryName}>Kenya</span><span className={`${styles.countryTag} ${styles.available}`}>Available</span></div></div>
          <div className={styles.countryCard}><span className={styles.countryFlag}>🇮🇳</span><div className={styles.countryInfo}><span className={styles.countryName}>India</span><span className={`${styles.countryTag} ${styles.available}`}>Available</span></div></div>
          <div className={styles.countryCard}><span className={styles.countryFlag}>🇦🇪</span><div className={styles.countryInfo}><span className={styles.countryName}>UAE</span><span className={`${styles.countryTag} ${styles.available}`}>Available</span></div></div>
          <div className={styles.countryCard}><span className={styles.countryFlag}>🇬🇧</span><div className={styles.countryInfo}><span className={styles.countryName}>United Kingdom</span><span className={`${styles.countryTag} ${styles.available}`}>Available</span></div></div>
          <div className={styles.countryCard}><span className={styles.countryFlag}>🇺🇸</span><div className={styles.countryInfo}><span className={styles.countryName}>United States</span><span className={`${styles.countryTag} ${styles.available}`}>Available</span></div></div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section id="testimonials" className={styles.testimonialsSection}>
        <span className={styles.sectionLabel}>What Families Say</span>
        <h2 className={styles.sectionTitle}>Real stories from real families</h2>
        <div className={styles.testimonialsGrid}>
          <div className={styles.testimonialCard}>
            <div className={styles.starRating}>★★★★★</div>
            <p className={styles.testimonialQuote}>Finally an app that actually works in Kenya! My kids walk home from school and I can see every step on the map. Peace of mind I never had before.</p>
            <div className={styles.testimonialAuthor}><div className={styles.authorAvatar}>WM</div><div className={styles.authorDetails}><div className={styles.authorName}>Wanjiku M.</div><div className={styles.authorLocation}>Nairobi, Kenya</div></div></div>
          </div>
          <div className={styles.testimonialCard}>
            <div className={styles.starRating}>★★★★★</div>
            <p className={styles.testimonialQuote}>Set up a geofence around my daughter&apos;s school in Dubai. Got an alert the moment she arrived. Simple, fast, and the battery barely drains.</p>
            <div className={styles.testimonialAuthor}><div className={styles.authorAvatar}>AS</div><div className={styles.authorDetails}><div className={styles.authorName}>Arjun S.</div><div className={styles.authorLocation}>Dubai, UAE</div></div></div>
          </div>
          <div className={styles.testimonialCard}>
            <div className={styles.starRating}>★★★★★</div>
            <p className={styles.testimonialQuote}>Our family is split between London and Mumbai. This app keeps us all connected. No ads, no subscription, just works.</p>
            <div className={styles.testimonialAuthor}><div className={styles.authorAvatar}>PR</div><div className={styles.authorDetails}><div className={styles.authorName}>Priya R.</div><div className={styles.authorLocation}>London, UK</div></div></div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className={styles.pricingSection}>
        <span className={styles.sectionLabel}>Simple Pricing</span>
        <h2 className={styles.sectionTitle}>Choose the right plan<br />for your family</h2>
        <p className={styles.sectionSubtitle}>Start for free — upgrade anytime. No hidden charges.</p>
        <div className={styles.pricingGrid}>
          <div className={`${styles.pricingCard} ${styles.revealUp}`}>
            <div className={styles.pricingPlanName}>Free Forever</div>
            <div className={styles.pricingPrice}><sup>₹</sup>0<sub>/month</sub></div>
            <p className={styles.pricingDesc}>The perfect starting point for small families</p>
            <ul className={styles.pricingFeatures}>
              <li>Live location sharing</li>
              <li>Family Circle (up to 4 members)</li>
              <li>1 Safe Zone / Geofence</li>
              <li>SOS Panic Button</li>
              <li>Basic push alerts</li>
              <li>24-hour location history</li>
              <li className="no">Battery level reports</li>
              <li className="no">Unlimited safe zones</li>
              <li className="no">Priority support</li>
            </ul>
            <Link to="/login" className={`${styles.pricingCta} ${styles.freeCta}`}>Start Free — No Card Needed</Link>
          </div>
          <div className={`${styles.pricingCard} ${styles.popular} ${styles.revealUp}`} style={{ transitionDelay: '0.12s' }}>
            <div className={styles.popularBadge}>⭐ Most Popular</div>
            <div className={styles.pricingPlanName}>Pro</div>
            <div className={styles.pricingPrice}><sup>₹</sup>99<sub>/month</sub></div>
            <p className={styles.pricingDesc}>For larger families and complete control</p>
            <ul className={styles.pricingFeatures}>
              <li>Everything in Free</li>
              <li>Family Circle (up to 20 members)</li>
              <li>Unlimited Safe Zones</li>
              <li>SOS + Auto emergency call</li>
              <li>Instant priority alerts</li>
              <li>30-day location history</li>
              <li>Battery level reports</li>
              <li>Journey tracking</li>
              <li>Priority support 24/7</li>
            </ul>
            <Link to="/login" className={`${styles.pricingCta} ${styles.proCta}`}>Get Pro — ₹99/mo</Link>
          </div>
        </div>
        <p className={styles.pricingNote}>💳 UPI, Credit/Debit Card accepted &nbsp;·&nbsp; Cancel anytime &nbsp;·&nbsp; 7-day free trial on Pro</p>
      </section>

      {/* DOWNLOAD */}
      <section id="download" className={styles.downloadSection}>
        <h2 className={styles.downloadHeadline}>Download <span>Trackalways Gravity</span> Free</h2>
        <p className={styles.downloadSubtext}>No subscription. No ads. Just your family, safer.</p>
        <p className={styles.downloadNote}>Available on Android &amp; iOS — built with React Native</p>
        <div className={styles.storeBadges}>
          <a href="https://play.google.com/store/apps/details?id=com.trackalways.gravity" className={styles.storeBadge} target="_blank" rel="noopener noreferrer">
            <div className={styles.storeBadgeIcon}><svg viewBox="0 0 24 24" width="32" height="32"><path fill="#00C853" d="M3 20.5v-17c0-.83.94-1.3 1.6-.8l14 8.5c.6.36.6 1.24 0 1.6l-14 8.5c-.66.5-1.6.03-1.6-.8z"/></svg></div>
            <div className={styles.storeBadgeText}><span className={styles.storeBadgeSmall}>Get it on</span><span className={styles.storeBadgeName}>Google Play</span></div>
          </a>
          <a href="https://apps.apple.com/app/trackalways-gravity/id0000000000" className={styles.storeBadge} target="_blank" rel="noopener noreferrer">
            <div className={styles.storeBadgeIcon}><svg viewBox="0 0 24 24" width="32" height="32"><path fill="white" d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg></div>
            <div className={styles.storeBadgeText}><span className={styles.storeBadgeSmall}>Download on the</span><span className={styles.storeBadgeName}>App Store</span></div>
          </a>
        </div>
        <p className={styles.brandNote}>by Trackalways</p>
      </section>

      {/* FOOTER */}
      <footer id="footer" className={styles.footerSection}>
        <div className={styles.footerTop}>
          <div className={styles.footerBrand}>
            <div className={styles.footerLogo}>
              <div className={styles.footerLogoIcon}>G</div>
              <span className={styles.footerLogoName}>Gravity</span>
            </div>
            <p className={styles.footerTagline}>Real-time family safety for the modern world. A Trackalways product.</p>
            <div className={styles.footerSocials}>
              <a href="#" className={styles.socialIcon} aria-label="X / Twitter">
                <svg viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.738l7.732-8.835L1.254 2.25H8.08l4.258 5.63 5.906-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              </a>
              <a href="#" className={styles.socialIcon} aria-label="Instagram">
                <svg viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
              </a>
              <a href="#" className={styles.socialIcon} aria-label="LinkedIn">
                <svg viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
              </a>
            </div>
          </div>
          <div className={styles.footerCol}>
            <h4 className={styles.footerColHeading}>Product</h4>
            <ul className={styles.footerLinks}><li><a href="#features">Features</a></li><li><a href="#how">How it works</a></li><li><a href="#download">Download</a></li><li><a href="#">Pricing</a></li></ul>
          </div>
          <div className={styles.footerCol}>
            <h4 className={styles.footerColHeading}>Panels</h4>
            <ul className={styles.footerLinks}>
              <li><Link to="/parent">For Parents</Link></li>
              <li><Link to="/child">For Children</Link></li>
              <li><Link to="/login">Sign In</Link></li>
              <li><Link to="/login?redirect=/parent/panel">Parent Panel</Link></li>
              <li><Link to="/login?redirect=/child/panel">Child Panel</Link></li>
            </ul>
          </div>
          <div className={styles.footerCol}>
            <h4 className={styles.footerColHeading}>Company</h4>
            <ul className={styles.footerLinks}><li><a href="#">About Trackalways</a></li><li><a href="#">Privacy Policy</a></li><li><a href="#">Terms of Service</a></li><li><a href="#">Contact Us</a></li></ul>
          </div>
        </div>
        <div className={styles.footerBottom}>
          <span className={styles.footerBottomLeft}>© 2026 Trackalways Limited. All rights reserved.</span>
          <span className={styles.footerBottomRight}>Made with ❤️ for families worldwide</span>
        </div>
      </footer>
    </>
  )
}
