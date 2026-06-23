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
        { name: 'Grand Pa', seed: 'oldman-gp',  lat: 19.0920, lng: 72.8620, color: '#AB47BC', speed: null      }
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
          <li><a href="#download">Download</a></li>
          <li><Link to="/parent">For Parents</Link></li>
          <li><Link to="/child">For Children</Link></li>
          <li><Link to="/login?redirect=/parent/panel">Parent Panel</Link></li>
          <li><Link to="/login?redirect=/child/panel">Child Panel</Link></li>
        </ul>

        <Link to="/login" className={`${styles.navCta} ${styles.desktopOnly}`}>Get Started</Link>

        <label htmlFor="nav-toggle" className={styles.hamburgerLabel}>
          <span></span>
          <span></span>
          <span></span>
        </label>
      </nav>

      <div className={`${styles.navMobileMenu}${mobileMenuOpen ? ' ' + styles.navMobileMenuOpen : ''}`}>
        <a href="#features" onClick={() => setMobileMenuOpen(false)}>Features</a>
        <a href="#download" onClick={() => setMobileMenuOpen(false)}>Download</a>
        <Link to="/parent" onClick={() => setMobileMenuOpen(false)}>For Parents</Link>
        <Link to="/child" onClick={() => setMobileMenuOpen(false)}>For Children</Link>
        <Link to="/login?redirect=/parent/panel" onClick={() => setMobileMenuOpen(false)}>Parent Panel</Link>
        <Link to="/login?redirect=/child/panel" onClick={() => setMobileMenuOpen(false)}>Child Panel</Link>
        <Link to="/login" className={styles.navCta} onClick={() => setMobileMenuOpen(false)}>Get Started</Link>
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
            <Link className={styles.btnPrimaryHero} to="/login">Get Started Free</Link>
            <a className={styles.btnSecondaryHero} href="#features">See Features →</a>
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
              <img src="https://picsum.photos/seed/oldman-gp/40/40" className={styles.memberPhoto} alt="" />
              <div className={styles.memberInfo}><span className={styles.memberName}>Grand Pa</span><span className={`${styles.memberStatus} ${styles.online}`}>● Park • 3min</span></div>
            </div>
          </div>
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
              <a className={styles.fc2Arrow} href="#features">→</a>
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
              <a className={styles.fc2Arrow} href="#features">→</a>
            </div>

            {/* 3. SOS */}
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
              <a className={styles.fc2Arrow} href="#features">→</a>
            </div>

          </div>
        </div>
      </section>


      {/* DOWNLOAD */}
      <section id="download" className={styles.downloadSection}>
        <h2 className={styles.downloadHeadline}>Download Gravity for <span>Android</span></h2>
        <p className={styles.downloadSubtext}>Keep your family safe — get the app on your phone.</p>
        <a
          className={styles.downloadBtn}
          href="https://gravitypro.kvlbusinesssolutions.com/downloads/GravityPro.apk"
          download
        >
          Download for Android (APK)
        </a>
        <p className={styles.downloadNote}>Always the latest version • Installed apps auto-update — no reinstall needed.</p>
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
            <ul className={styles.footerLinks}>
              <li><a href="#features">Features</a></li>
              <li><a href="#how">How it works</a></li>
              <li><a href="#download">Download</a></li>
            </ul>
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
            <ul className={styles.footerLinks}>
              <li><a href="#features">About Gravity</a></li>
              <li><Link to="/privacy">Privacy Policy</Link></li>
              <li><Link to="/terms">Terms of Service</Link></li>
              <li><a href="mailto:support@trackalways.com">Contact Us</a></li>
            </ul>
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
