import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { BrandMark, IconArrow } from './Icons.jsx'
import { primaryNav, footerNav, brand } from '../lib/content.js'
import { useSticky, useMagnetic, useScrollProgress } from '../lib/motion.js'

/* ---------- Ambient field ------------------------------------ */
/* Flat colour washes and outlined rings. No blur filters, no
   transparency stacking — the page stays on solid paper. */

export function Ambient() {
  return (
    <div className="ambient" aria-hidden="true">
      <span className="ambient__blob ambient__blob--sage" />
      <span className="ambient__blob ambient__blob--lime" />
      <span className="ambient__dot ambient__dot--a" />
      <span className="ambient__dot ambient__dot--b" />
    </div>
  )
}

export function ScrollRail() {
  const ref = useScrollProgress()
  return (
    <div className="scroll-rail" aria-hidden="true">
      <div className="scroll-rail__fill" ref={ref} />
    </div>
  )
}

/* ---------- Magnetic button ----------------------------------- */

export function MagneticLink({ to, href, className = 'btn btn--primary', children, ...rest }) {
  const ref = useMagnetic()
  const cls = `${className} magnetic`
  if (to) {
    return (
      <Link ref={ref} to={to} className={cls} {...rest}>
        {children}
      </Link>
    )
  }
  return (
    <a ref={ref} href={href} className={cls} {...rest}>
      {children}
    </a>
  )
}

/* ---------- Masthead ------------------------------------------ */

export function Masthead() {
  const { ref, stuck } = useSticky(24)
  const [open, setOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <header className={`masthead${stuck || open ? ' is-stuck' : ''}`} ref={ref}>
      <div className="shell masthead__inner">
        <Link to="/" className="brand" aria-label={`${brand.name} home`}>
          <BrandMark className="brand__mark" />
          <span>{brand.name}</span>
        </Link>

        <nav className="nav" aria-label="Primary">
          {primaryNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav__link${isActive ? ' is-active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="masthead__actions">
          <Link to="/patient" className="btn btn--forest btn--sm">
            Start intake
          </Link>
          <button
            type="button"
            className="nav-toggle"
            aria-expanded={open}
            aria-controls="nav-sheet"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="nav-toggle__bar" />
            <span className="nav-toggle__bar" />
            <span className="nav-toggle__bar" />
          </button>
        </div>
      </div>

      <div id="nav-sheet" className={`nav-sheet${open ? ' is-open' : ''}`} hidden={!open}>
        {primaryNav.map((item) => (
          <Link key={item.to} to={item.to} className="nav-sheet__link">
            {item.label}
          </Link>
        ))}
        <div className="nav-sheet__actions">
          <Link to="/patient" className="btn btn--primary btn--block">
            Start your intake
          </Link>
          <Link to="/contact" className="btn btn--ghost btn--block">
            Talk to us
          </Link>
        </div>
      </div>
    </header>
  )
}

/* ---------- Footer -------------------------------------------- */

export function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className="footer">
      <div className="shell">
        <div className="footer__grid">
          <div>
            <Link to="/" className="brand" aria-label={`${brand.name} home`}>
              <BrandMark className="brand__mark" />
              <span>{brand.name}</span>
            </Link>
            <p className="card__body footer__blurb" data-reveal>
              {brand.tagline} Guided medical card evaluation with licensed clinicians in fourteen
              states.
            </p>
            <p className="footer__contact" data-reveal>
              <a href={`mailto:${brand.email}`} className="link-arrow">
                {brand.email}
                <IconArrow size={15} className="link-arrow__glyph" />
              </a>
            </p>
          </div>

          {footerNav.map((column) => (
            <div key={column.title}>
              <p className="footer__col-title">{column.title}</p>
              <ul className="footer__links">
                {column.links.map((link) => (
                  <li key={link.to}>
                    <Link to={link.to}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="footer__bottom">
          <p>
            © {year} {brand.name}. All rights reserved.
          </p>
          <div className="footer__legal">
            <Link to="/medical-disclaimer">Medical disclaimer</Link>
            <Link to="/telehealth-consent">Telehealth consent</Link>
            <Link to="/privacy-policy">Privacy</Link>
            <Link to="/accessibility">Accessibility</Link>
          </div>
        </div>

        <p className="footer__note" data-reveal>
          {brand.name} is not a healthcare provider. Evaluations are performed by independently
          licensed clinicians. Approval of any card is decided by the relevant state registry, not by{' '}
          {brand.name}.
        </p>
      </div>
    </footer>
  )
}
