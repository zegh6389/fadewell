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
  proofRibbon,
  preparationItems,
  afterAppointment,
  patientPaths,
  caregiver,
  tagline,
  compliance,
  learningResources
} from '../lib/content.js'
import { useCountUp, useTrackOverflow, useReveal } from '../lib/motion.js'
import { Icon, IconCheck, IconStar, IconArrow } from '../components/Icons.jsx'
import { MagneticLink } from '../components/Chrome.jsx'
import { Marquee, WordReveal } from '../components/Motion.jsx'
import { LaunchNotice } from '../components/LaunchNotice.jsx'
import { StateSelector } from '../components/StateSelector.jsx'
import { QuerySection } from '../components/QuerySection.jsx'
import { PatientHelp } from '../components/PatientHelp.jsx'
import { StatesPanel } from '../components/StatesPanel.jsx'
import { RESOURCE_IMAGES, SampleCard, TelehealthScene } from '../components/PremiumHero.jsx'

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
              <span className="d-1">Your medical card.</span>
            </span>
            <span className="reveal-line">
              <span className="grad-text d-2">Your kind of care.</span>
            </span>
          </h1>

          <div className="hero__lower">
            <div className="hero__intro">
              <p className="hero-typewriter"><span>Less waiting. More living.</span></p>
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
              <TelehealthScene />
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
            {/* Trailing gutter, as a real element rather than trailing padding:
                Chromium leaves trailing padding out of `scrollWidth`, and
                `useTrackOverflow` derives the travel distance from it. */}
            <span className="journey__pad" aria-hidden="true" />
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
          <p className="eyebrow eyebrow--accent">Why MmjGreen</p>
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
    <section className="section--tight" aria-label="MmjGreen by the numbers">
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
            <span className="tag tag--moss plan__badge">{featured.badge}</span>
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

/* ---------- Proof ribbon -------------------------------------- */

function ProofRibbon() {
  return (
    <section className="section--tight" aria-label="What to expect">
      <div className="shell">
        <ul className="proof__grid">
          {proofRibbon.map((item) => (
            <li className="proof__item" key={item.title} data-reveal="fade">
              <span className="proof__disc" aria-hidden="true">
                <Icon name={item.icon} size={20} />
              </span>
              <span>
                <strong className="proof__title">{item.title}</strong>
                <span className="proof__note">{item.note}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="proof__terms" data-reveal="fade">
          The evaluation fee is refunded if a clinician does not approve. State programme fees are separate. See{' '}
          <Link className="text-link" to="/terms-conditions">
            terms
          </Link>
          .
        </p>
      </div>
    </section>
  )
}

/* ---------- Before you begin ----------------------------------- */

function Prepare() {
  return (
    <section className="band-white section" aria-labelledby="prepare-title">
      <div className="shell">
        <div className="section-head" data-reveal="fade">
          <div>
            <p className="eyebrow eyebrow--accent">Before you begin</p>
            <h2 className="h2" id="prepare-title">
              Be ready before
              <span className="serif grad-text"> your evaluation.</span>
            </h2>
          </div>
          <p className="lede">
            Requirements differ by state and by clinician. These are the items that most often make a visit go
            smoothly, and almost all of them you already have somewhere.
          </p>
        </div>

        <div className="grid grid--4">
          {preparationItems.map((item) => (
            <article className="card" key={item.title} data-reveal="fade">
              <span className="proof__disc" aria-hidden="true">
                <Icon name={item.icon} size={20} />
              </span>
              <h3 className="card__title">{item.title}</h3>
              <p className="card__body">{item.note}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ---------- Two-panel visual story ----------------------------- */

function VisualStory() {
  const panels = [
    {
      src: '/assets/telehealth-consultation.webp',
      alt: 'Illustrative stock photograph of a physician with a stethoscope, not an actual MmjGreen clinician',
      index: '01 / Your evaluation',
      title: 'Clarity, from the start.',
      body: 'Understand what to prepare, meet with a licensed clinician where your state allows it, and keep the state process separate from the medical decision.',
      className: 'story-frame story-frame--wide',
      to: '/service'
    },
    {
      src: '/assets/botanical-bud.webp',
      alt: 'Detail of a cannabis flower, accompanying guidance about medical card registration',
      index: '02 / After approval',
      title: 'A calmer next chapter.',
      body: 'If you are approved, we handle the registry submission and track it to issuance, so you always know which step is yours and which is ours.',
      className: 'story-frame story-frame--portrait',
      to: '/patient-info'
    }
  ]

  return (
    <section className="band-sage section" aria-labelledby="visual-story-title">
      <div className="shell">
        <div className="section-head" data-reveal="fade">
          <div>
            <p className="eyebrow eyebrow--accent">Designed around the journey</p>
            <h2 className="h2" id="visual-story-title">
              Built so the hard part
              <span className="serif grad-text"> feels obvious.</span>
            </h2>
          </div>
          <p className="lede">
            Two things people want to know: what the evaluation involves, and what happens afterwards. Both get
            their own page, because both get asked about constantly.
          </p>
        </div>

        <div className="story-frames">
          {panels.map((panel) => (
            <figure className={panel.className} key={panel.index} data-reveal>
              <div className="story-frame__media drift drift--mid">
                <img src={panel.src} alt={panel.alt} width="1200" height="900" loading="lazy" decoding="async" />
              </div>
              <figcaption>
                <span className="story-frame__index">{panel.index}</span>
                <strong className="story-frame__title">{panel.title}</strong>
                <p className="story-frame__body">{panel.body}</p>
                <Link className="text-link" to={panel.to}>
                  Read more
                </Link>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ---------- New vs returning ------------------------------------ */

function PatientPaths() {
  return (
    <section className="band-white section" aria-labelledby="paths-title">
      <div className="shell">
        <h2 className="sr-only" id="paths-title">
          Where to start
        </h2>
        <div className="paths">
          {patientPaths.map((path) => (
            <article className={`path-card path-card--${path.key}`} key={path.key} data-reveal="fade">
              <p className="eyebrow">{path.eyebrow}</p>
              <h3 className="h3">{path.title}</h3>
              <p className="lede">{path.body}</p>
              <Link className={`btn ${path.key === 'new' ? 'btn--primary' : 'btn--forest'}`} to={path.to}>
                {path.action}
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ---------- After your appointment ------------------------------ */

function AfterAppointment() {
  return (
    <section className="band-sage section" aria-labelledby="after-title">
      <div className="shell split">
        <div data-reveal="fade">
          <p className="eyebrow eyebrow--accent">After your appointment</p>
          <h2 className="h2" id="after-title">
            A clinician’s decision is not
            <span className="serif grad-text"> the last step.</span>
          </h2>
          <p className="lede">
            Certification does not by itself produce a state card. If you are approved, your state usually runs its
            own registration, its own fee and its own waiting period — and that is the part most people are not
            expecting.
          </p>
          <Link className="btn btn--forest" to="/blog/certification-is-not-a-state-card">
            Why this catches people out
          </Link>
        </div>

        <ul className="after" data-reveal>
          {afterAppointment.map((text) => (
            <li className="after__item" key={text}>
              <span className="after__tick" aria-hidden="true">
                <IconCheck size={15} />
              </span>
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ---------- Caregivers ----------------------------------------- */

function Caregivers() {
  return (
    <section className="band-dark section" aria-labelledby="caregiver-title">
      <div className="shell split">
        <div data-reveal="fade">
          <p className="eyebrow eyebrow--accent">{caregiver.eyebrow}</p>
          <h2 className="h2" id="caregiver-title">
            {caregiver.title}
          </h2>
        </div>
        <div data-reveal="fade">
          <p className="lede">{caregiver.body}</p>
          <Link className="btn btn--ghost" to={caregiver.to}>
            {caregiver.action}
          </Link>
        </div>
      </div>
    </section>
  )
}

/* ---------- Tagline -------------------------------------------- */

function Tagline() {
  return (
    <section className="section tagline" aria-label="Our approach">
      <div className="shell">
        <WordReveal lines={tagline} as="p" />
      </div>
    </section>
  )
}

/* ---------- Compliance ----------------------------------------- */

function Compliance() {
  return (
    <section className="band-white section" aria-labelledby="compliance-title">
      <div className="shell split">
        <div className="compliance__art" data-reveal="scale">
          <img
            className="compliance__badge"
            src="/assets/badge-compliance.webp"
            alt="Badge: HIPAA-aligned protected workflow"
            width="320"
            height="176"
            loading="lazy"
            decoding="async"
          />
          <span className="compliance__ring compliance__ring--a" aria-hidden="true" />
          <span className="compliance__ring compliance__ring--b" aria-hidden="true" />
        </div>

        <div data-reveal="fade">
          <p className="eyebrow eyebrow--accent">{compliance.eyebrow}</p>
          <h2 className="h2" id="compliance-title">
            {compliance.title}
          </h2>
          <p className="lede">{compliance.body}</p>
          <ul className="compliance__points">
            {compliance.points.map((point) => (
              <li className="compliance__point" key={point.title}>
                <span className="proof__disc" aria-hidden="true">
                  <Icon name={point.icon} size={19} />
                </span>
                <span>
                  <strong>{point.title}</strong>
                  <span className="compliance__note">{point.note}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

/* ---------- What you get --------------------------------------- */

function CardPreview() {
  return (
    <section className="band-sage section" aria-labelledby="preview-title">
      <div className="shell preview">
        <div className="preview__copy" data-reveal="fade">
          <p className="eyebrow eyebrow--accent">New evaluations and renewals</p>
          <h2 className="h2" id="preview-title">
            Guidance that stays
            <span className="serif grad-text"> useful afterwards.</span>
          </h2>
          <p className="lede">
            If a clinician approves you, we help you get through the remaining state registration. If you are
            renewing, we start from the rules that apply now — not the ones from your last visit.
          </p>
          <ul className="checklist">
            {['Registry submission handled for you', 'Every stage visible until issuance', 'Renewals checked against current rules'].map(
              (item) => (
                <li key={item}>
                  <span className="checklist__tick" aria-hidden="true" />
                  {item}
                </li>
              )
            )}
          </ul>
          <Link className="btn btn--primary" to="/care">
            Start an evaluation
          </Link>
        </div>

        <div className="preview__art" data-reveal="scale">
          <SampleCard />
          <p className="sample-caption">A preview of the possibilities. Actual cards are issued by your state.</p>
        </div>
      </div>
    </section>
  )
}

/* ---------- Learning centre ------------------------------------ */

function Learning() {
  return (
    <section className="band-white section" aria-labelledby="learn-title">
      <div className="shell">
        <div className="section-head" data-reveal="fade">
          <div>
            <p className="eyebrow eyebrow--accent">Resource centre</p>
            <h2 className="h2" id="learn-title">
              The answers people
              <span className="serif grad-text"> ask for most.</span>
            </h2>
          </div>
          <p className="lede">
            Original, plain-language writing about the parts of this process that catch people out. No promises
            about outcomes, because nobody can honestly make them.
          </p>
        </div>

        <div className="grid grid--3">
          {learningResources.map((item) => (
            <article className="card" key={item.slug} data-reveal="fade">
              <img className="resource-cover" src={RESOURCE_IMAGES[item.slug]} alt="" width="1000" height="667" loading="lazy" decoding="async" />
              <span className="tag tag--moss">{item.category}</span>
              <h3 className="card__title">{item.title}</h3>
              <p className="card__body">{item.note}</p>
              <span className="card__foot">
                <Link className="text-link" to={`/blog/${item.slug}`}>
                  Read the piece
                </Link>
              </span>
            </article>
          ))}
        </div>

        <div className="learn__all" data-reveal="fade">
          <Link className="btn btn--forest" to="/blog">
            Explore all resources
          </Link>
        </div>
      </div>
    </section>
  )
}

/* ---------- Closing CTA --------------------------------------- */

function ClosingCta() {
  return (
    <section className="section" id="eligibility" aria-labelledby="cta-title">
      <div className="shell split split--cta">
        <div data-reveal="fade">
          <h2 className="h2" id="cta-title">
            Start with the state
            <span className="serif grad-text"> you call home.</span>
          </h2>
          <p className="lede">
            See current availability and the path that applies to you. A clinician, not this website, determines
            eligibility.
          </p>
        </div>
        <div data-reveal="fade">
          <StateSelector compact />
        </div>
      </div>
    </section>
  )
}

export default function Home() {
  return (
    <>
      <LaunchNotice />
      <Hero />
      <ProofRibbon />
      <Trust />
      <Marquee
        label="Service benefits"
        duration={38}
        items={[
          'HIPAA-aligned workflow',
          'Licensed clinician review',
          'State-specific guidance',
          'Video or phone, your choice',
          'Tracked to issuance'
        ]}
      />
      <Prepare />
      <Journey />
      <Story />
      <VisualStory />
      <Pillars />
      <PatientPaths />
      <AfterAppointment />
      <Caregivers />
      <Tagline />
      <Stats />
      <StatesPanel />
      <Compliance />
      <CardPreview />
      <Learning />
      <Testimonials />
      <PricingTeaser />
      <QuerySection />
      <ClosingCta />
      <PatientHelp />
    </>
  )
}
