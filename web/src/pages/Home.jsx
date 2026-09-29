import { useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  hero,
  journey,
  storySteps,
  stats,
  trustMarks,
  pillars,
  testimonials,
  plans,
  brand
} from '../lib/content.js'
import { useCountUp, useTrackOverflow, useReveal } from '../lib/motion.js'
import { Icon, IconCheck, IconStar, IconArrow, IconSpark } from '../components/Icons.jsx'
import { MagneticLink } from '../components/Chrome.jsx'

/* ---------- Animated stat ------------------------------------- */

function Stat({ value, suffix, label, decimals = 0 }) {
  const { ref, display } = useCountUp(value, { decimals })
  const shown = decimals > 0 ? display.toFixed(decimals) : Math.round(display).toLocaleString('en-US')
  return (
    <div className="stat" ref={ref}>
      <span className="stat__value">
        {shown}
        {suffix}
      </span>
      <span className="stat__label">{label}</span>
    </div>
  )
}

/* ---------- Hero --------------------------------------------- */

function Hero() {
  return (
    <section className="hero">
      <div className="shell hero__grid">
        <div className="hero__content">
          <span className="pill" data-reveal="fade">
            <span className="pill__dot" />
            {hero.pill}
          </span>

          <h1 className="hero__title">
            <span className="reveal-line">
              <span className="d-1">Care that meets you</span>
            </span>
            <span className="reveal-line">
              <span className="serif grad-text d-2">{hero.titleAccent}</span>
            </span>
          </h1>

          {/*
            The headline spans the full shell so the display type can run large
            without wrapping. Everything below it settles into two columns.
          */}
          <div className="hero__lower">
            <div className="hero__intro">
              <p className="lede" data-reveal>
                {hero.lede}
              </p>

              <div className="hero__actions" data-reveal="fade">
                <MagneticLink to={hero.primaryCta.to} className="btn btn--primary btn--lg">
                  {hero.primaryCta.label}
                  <IconArrow size={17} />
                </MagneticLink>
                <Link to={hero.secondaryCta.to} className="btn btn--ghost btn--lg">
                  {hero.secondaryCta.label}
                </Link>
              </div>

              <ul className="hero__notes" data-reveal="fade">
                {hero.notes.map((note) => (
                  <li key={note} className="trust__item">
                    <IconCheck size={15} />
                    {note}
                  </li>
                ))}
              </ul>
            </div>

            <div className="hero__visual" data-reveal="scale">
              <span className="orb-ring orb-ring--1 spin-slow" aria-hidden="true" />
              <span className="orb-ring orb-ring--2 spin-rev" aria-hidden="true" />

              <article className="float-card float-card--main">
                <div className="float-card__head">
                  <span className="float-avatar" aria-hidden="true">
                    AO
                  </span>
                  <div>
                    <p className="float-card__title">Dr. Amara Osei, MD</p>
                    <p className="float-card__meta">Evaluating physician · Colorado</p>
                  </div>
                </div>

                <div className="float-row">
                  <span className="float-row__label">Intake review</span>
                  <span className="float-row__value">Complete</span>
                </div>
                <div className="float-bar">
                  <span className="float-bar__fill" />
                </div>

                <div className="float-row">
                  <span className="float-row__label">Consultation</span>
                  <span className="float-row__value">Today, 4:30 PM</span>
                </div>
                <div className="float-row">
                  <span className="float-row__label">State registry</span>
                  <span className="tag tag--mint">Filed</span>
                </div>
              </article>

              <article className="float-card float-card--a">
                <p className="float-card__meta">Jurisdiction</p>
                <p className="float-card__title" data-reveal="fade">
                  Colorado · Active
                </p>
                <span className="tag tag--cyan" data-reveal="fade">
                  Verified rules
                </span>
              </article>

              <article className="float-card float-card--b">
                <p className="float-card__meta">Median decision</p>
                <p className="float-card__title" data-reveal="fade">
                  2.4 days
                </p>
                <p className="float-card__meta">Tracked to issuance</p>
              </article>
            </div>
          </div>
        </div>
      </div>

      <div className="hero__scroll" aria-hidden="true">
        <span>Scroll</span>
        <span className="hero__scroll-rail" />
      </div>
    </section>
  )
}

/* ---------- Trust strip --------------------------------------- */

function Trust() {
  return (
    <section className="section--tight" aria-label="How we protect you">
      <div className="shell">
        <ul className="trust">
          {trustMarks.map((mark) => (
            <li key={mark.label} className="trust__item" data-reveal="fade">
              <Icon name={mark.icon} size={18} />
              {mark.label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ---------- Pinned horizontal journey ------------------------- */

function Journey() {
  const trackRef = useRef(null)
  const viewportRef = useRef(null)
  useTrackOverflow(trackRef, viewportRef)

  return (
    <section className="journey" id="journey" aria-labelledby="journey-title">
      <div className="journey__pin">
        <div className="shell journey__head">
          <div className="section-head" data-reveal>
            <p className="eyebrow eyebrow--accent">The path</p>
            <h2 className="h2" id="journey-title">
              Five steps. <span className="serif grad-text">No dead ends.</span>
            </h2>
          </div>
          <p className="lede journey__head-note" data-reveal>
            Most services lose you somewhere in the middle. This is the whole thing, start to finish.
          </p>
        </div>

        {/*
          Below 640px this viewport becomes a native horizontal scroller with
          scroll-snap, which is focusable by touch but not by keyboard. Making
          it a labelled, tabbable group keeps every step reachable without a
          pointer (WCAG 2.1.1).
        */}
        <div
          className="journey__viewport"
          ref={viewportRef}
          role="group"
          aria-label="The five steps of your evaluation, side by side"
          tabIndex={0}
        >
          <div className="journey__track pin-track" ref={trackRef}>
            {journey.map((item) => (
              <article className="journey__panel" key={item.step}>
                <div>
                  <p className="journey__step">{item.step}</p>
                  <span className="journey__icon">
                    <Icon name={item.icon} size={24} />
                  </span>
                </div>
                <div>
                  <h3 className="h4">{item.title}</h3>
                  <p className="card__body">{item.body}</p>
                </div>
                <p className="float-card__meta">{item.detail}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="shell">
          <div className="journey__progress">
            <span className="journey__progress-fill timeline-fill timeline-fill--x" />
          </div>
        </div>
      </div>
    </section>
  )
}

/* ---------- Sticky story -------------------------------------- */

function Story() {
  return (
    <section className="section" aria-labelledby="story-title">
      <div className="shell story">
        <div className="story__rail">
          <p className="eyebrow eyebrow--accent">Why FadeWell</p>
          <h2 className="h2" id="story-title" data-reveal>
            Built to remove the friction, not the rigour.
          </h2>
          <p className="lede" data-reveal>
            A medical card is a legal document built from a clinical conversation. The software should
            make that conversation easier — never vague about what is happening to your health
            information.
          </p>
          <div className="story__rail-line" aria-hidden="true" />
        </div>

        <div className="story__steps">
          {storySteps.map((step) => (
            <article className="story__step" key={step.num} data-reveal>
              <p className="story__step-num">{step.num}</p>
              <h3 className="h3">{step.title}</h3>
              <p className="card__body">{step.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ---------- Stats --------------------------------------------- */

function Stats() {
  return (
    <section className="section--tight" aria-label="FadeWell by the numbers">
      <div className="shell">
        <div className="stats" data-reveal="scale">
          {stats.map((stat) => (
            <Stat key={stat.label} {...stat} />
          ))}
        </div>
      </div>
    </section>
  )
}

/* ---------- Pillars ------------------------------------------- */

function Pillars() {
  const ref = useReveal()
  return (
    <section className="section" aria-labelledby="pillars-title" ref={ref}>
      <div className="shell">
        <div className="section-head">
          <p className="eyebrow eyebrow--accent">What you get</p>
          <h2 className="h2" id="pillars-title" data-reveal>
            The parts that usually go wrong, <span className="serif grad-text">handled.</span>
          </h2>
        </div>

        <div className="spotlight-grid spotlight-grid--2">
          {pillars.map((pillar) => (
            <div className="spotlight-cell" key={pillar.title}>
              <span className="journey__icon">
                <Icon name={pillar.icon} size={22} />
              </span>
              <h3 className="h4 card__title">{pillar.title}</h3>
              <p className="card__body">{pillar.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ---------- Testimonials -------------------------------------- */

function Testimonials() {
  return (
    <section className="section" aria-labelledby="voices-title">
      <div className="shell">
        <div className="section-head">
          <p className="eyebrow eyebrow--accent">Patient voices</p>
          <h2 className="h2" id="voices-title" data-reveal>
            People who got their card <span className="serif grad-text">the calm way.</span>
          </h2>
        </div>

        <div className="grid grid--2">
          {testimonials.map((item) => (
            <figure className="quote" key={item.name} data-reveal>
              <div className="quote__stars" role="img" aria-label={`${item.rating} out of 5`}>
                {Array.from({ length: item.rating }, (_, i) => (
                  <IconStar key={i} size={15} />
                ))}
              </div>
              <blockquote className="quote__text">“{item.quote}”</blockquote>
              <figcaption className="quote__by">
                <span className="quote__avatar" aria-hidden="true">
                  {item.name.charAt(0)}
                </span>
                <span>
                  <span className="quote__name">{item.name}</span>
                  <br />
                  <span className="quote__loc">{item.location}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ---------- Pricing teaser ------------------------------------ */

function PricingTeaser() {
  const featured = plans[0]
  return (
    <section className="section" aria-labelledby="price-title">
      <div className="shell">
        <div className="section-head">
          <p className="eyebrow eyebrow--accent">Pricing</p>
          <h2 className="h2" id="price-title" data-reveal>
            One price. <span className="serif grad-text">No surprises.</span>
          </h2>
        </div>

        <div className="grid grid--2">
          <div className="plan plan--featured" data-reveal>
            <span className="tag tag--cyan plan__badge">{featured.badge}</span>
            <h3 className="plan__name">{featured.name}</h3>
            <p className="plan__price">
              ${featured.price}
              <small>{featured.cadence}</small>
            </p>
            <p className="plan__desc">{featured.description}</p>
            <ul className="plan__list">
              {featured.features.map((feature) => (
                <li key={feature}>
                  <IconCheck size={16} />
                  {feature}
                </li>
              ))}
            </ul>
            <MagneticLink to={featured.cta.to} className="btn btn--primary btn--block">
              {featured.cta.label}
              <IconArrow size={16} />
            </MagneticLink>
          </div>

          <div className="split__body" data-reveal="right">
            <h3 className="h3">What that actually includes</h3>
            <p className="card__body">
              A complete evaluation, your state application prepared and filed, and someone tracking it
              with you until the card is issued. We do not charge a membership, and we do not sell your
              information to anyone.
            </p>
            <ul className="checklist">
              <li>
                <IconCheck size={16} />
                State application fees are paid to your registry, never to us
              </li>
              <li>
                <IconCheck size={16} />
                Free re-evaluation within 90 days if a first application is denied
              </li>
              <li>
                <IconCheck size={16} />
                Full refund if you cancel more than 24 hours before your visit
              </li>
            </ul>
            <Link to="/pricing" className="link-arrow">
              Compare every plan
              <IconArrow size={15} className="link-arrow__glyph" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ---------- Closing CTA --------------------------------------- */

function ClosingCta() {
  return (
    <section className="section" aria-labelledby="cta-title">
      <div className="shell">
        <div className="cta" data-reveal="scale">
          <span className="cta__halo" aria-hidden="true" />
          <div className="cta__inner">
            <span className="pill">
              <IconSpark size={13} />
              Takes about six minutes
            </span>
            <h2 className="h1" id="cta-title">
              Your card is <span className="serif grad-text">closer</span> than you think.
            </h2>
            <p className="lede">
              Start the questionnaire. You will know your next step before you finish it — and if we
              cannot help, we will tell you that first.
            </p>
            <div className="hero__actions" data-reveal="fade">
              <MagneticLink to="/patient" className="btn btn--primary btn--lg">
                Start your intake
                <IconArrow size={17} />
              </MagneticLink>
              <Link to="/contact" className="btn btn--ghost btn--lg">
                Ask a question first
              </Link>
            </div>
            <p className="hero__note">
              Questions? {brand.phone} · {brand.hours}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

export default function Home() {
  return (
    <>
      <Hero />
      <Trust />
      <Journey />
      <Story />
      <Stats />
      <Pillars />
      <Testimonials />
      <PricingTeaser />
      <ClosingCta />
    </>
  )
}
