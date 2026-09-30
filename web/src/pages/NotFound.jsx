import { Link } from 'react-router-dom'
import { primaryNav } from '../lib/content.js'
import { IconArrow } from '../components/Icons.jsx'
import { MagneticLink } from '../components/Chrome.jsx'

export default function NotFound() {
  return (
    <section className="page-hero notfound">
      <div className="shell page-hero__inner">
        <p className="eyebrow eyebrow--accent" data-reveal="fade">
          Error 404
        </p>
        <h1 className="display" data-reveal>
          This page <span className="serif grad-text">is not here.</span>
        </h1>
        <p className="lede" data-reveal>
          The link may be out of date, or the address may have a typo in it. Here is everything that
          does exist.
        </p>

        <nav className="notfound__links" aria-label="Site sections" data-reveal>
          {primaryNav.map((item) => (
            <Link key={item.to} to={item.to} className="btn btn--ghost">
              {item.label}
              <IconArrow size={15} />
            </Link>
          ))}
        </nav>

        <div className="hero__actions" data-reveal="fade">
          <MagneticLink to="/" className="btn btn--primary btn--lg">
            Back to home
            <IconArrow size={17} />
          </MagneticLink>
          <Link to="/contact" className="btn btn--ghost btn--lg">
            Report a broken link
          </Link>
        </div>
      </div>
    </section>
  )
}
