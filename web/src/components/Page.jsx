import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconArrow, IconCheck, IconSpark } from './Icons.jsx'
import { MagneticLink } from './Chrome.jsx'
import { brand } from '../lib/content.js'

/* ---------- Interior page hero ------------------------------- */

export function PageHero({ eyebrow, title, accent, lede, children }) {
  return (
    <section className="page-hero">
      <div className="shell page-hero__inner">
        {eyebrow ? (
          <p className="eyebrow eyebrow--accent" data-reveal="fade">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="h1" data-reveal>
          {title}
          {accent ? <span className="serif grad-text"> {accent}</span> : null}
        </h1>
        {lede ? (
          <p className="lede" data-reveal>
            {lede}
          </p>
        ) : null}
        {children}
      </div>
    </section>
  )
}

/* ---------- Section heading ----------------------------------- */

export function SectionHead({ eyebrow, title, accent, lede, id }) {
  return (
    <div className="section-head">
      {eyebrow ? (
        <p className="eyebrow eyebrow--accent" data-reveal="fade">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="h2" id={id} data-reveal>
        {title}
        {accent ? <span className="serif grad-text"> {accent}</span> : null}
      </h2>
      {lede ? (
        <p className="lede" data-reveal>
          {lede}
        </p>
      ) : null}
    </div>
  )
}

/* ---------- Checklist ----------------------------------------- */

export function Checklist({ items, className = 'checklist' }) {
  return (
    <ul className={className}>
      {items.map((item) => (
        <li key={item}>
          <IconCheck size={16} />
          {item}
        </li>
      ))}
    </ul>
  )
}

/* ---------- Closing CTA band ---------------------------------- */

export function CtaBand({
  title,
  accent,
  body,
  primary = { label: 'Start your intake', to: '/patient' },
  secondary = { label: 'Talk to us', to: '/contact' }
}) {
  return (
    <section className="section">
      <div className="shell">
        <div className="cta" data-reveal="scale">
          <div className="cta__inner">
            <span className="pill">
              <IconSpark size={13} />
              {brand.hours}
            </span>
            <h2 className="h2">
              {title}
              {accent ? <span className="serif grad-text"> {accent}</span> : null}
            </h2>
            {body ? <p className="lede">{body}</p> : null}
            <div className="hero__actions" data-reveal="fade">
              <MagneticLink to={primary.to} className="btn btn--primary btn--lg">
                {primary.label}
                <IconArrow size={17} />
              </MagneticLink>
              <Link to={secondary.to} className="btn btn--ghost btn--lg">
                {secondary.label}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ---------- FAQ accordion ------------------------------------- */

export function FaqList({ items, initialOpen = 0 }) {
  return (
    <div className="accordion">
      {items.map((item, index) => (
        <FaqRow key={item.q} item={item} open={index === initialOpen} delay={index} />
      ))}
    </div>
  )
}

function FaqRow({ item, open: initial, delay }) {
  const open = useDisclosure(initial)
  return (
    <div className="accordion__item" data-reveal="fade">
      <h3>
        <button
          type="button"
          className="accordion__trigger"
          aria-expanded={open.value}
          aria-controls={`faq-panel-${delay}`}
          id={`faq-trigger-${delay}`}
          onClick={open.toggle}
        >
          {item.q}
          <span className="accordion__icon" aria-hidden="true" />
        </button>
      </h3>
      <div
        id={`faq-panel-${delay}`}
        role="region"
        aria-labelledby={`faq-trigger-${delay}`}
        className={`accordion__panel${open.value ? ' is-open' : ''}`}
      >
        <div className="accordion__inner">
          <p>{item.a}</p>
        </div>
      </div>
    </div>
  )
}

function useDisclosure(initial = false) {
  const [value, setValue] = useState(initial)
  const toggle = useCallback(() => setValue((v) => !v), [])
  return { value, toggle }
}
