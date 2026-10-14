import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { PageHero, CtaBand } from '../components/Page.jsx'
import { RESOURCE_IMAGES } from '../components/PremiumHero.jsx'
import NotFound from './NotFound.jsx'
import {
  articles,
  stateFees,
  stateNotes,
  findResource,
  isStateGuide,
  searchStateGuides
} from '../lib/resourceCentre.js'

/**
 * Resource centre. Handles `/blog`, `/blog/:slug` for long-form articles,
 * and `/blog/:slug` for the per-state guides.
 *
 * One component rather than three, because an article and a state guide are
 * both "an index entry with its body expanded" — keeping them together means
 * nothing can be listed without also being reachable.
 *
 * The content is a static document in `lib/resourceCentre.js` rather than a
 * fetched feed. These are genuinely fixed, genuinely useful reference pages
 * whose value depends on being readable with no API reachable and no CMS to
 * keep alive. State guides carry their own sources and review dates; neither
 * is decorative, so neither is optional.
 */

/* Status colours reuse existing tags rather than adding new ones: a state
   without a programme is quiet, a limited one draws attention. */
const STATUS_CLASS = {
  'Medical program': 'tag--moss',
  'Limited program': 'tag--amber',
  'No statewide MMJ card program': 'tag--sage',
  'Implementation in progress': 'tag--lime'
}

function formatReviewed(value) {
  if (!value) return null
  const d = new Date(`${value}T12:00:00`)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Spreads inline figures through the body instead of stacking them at the end. */
function interleave(paragraphs, images) {
  if (!images?.length) return paragraphs.map((text) => ({ text }))
  const out = []
  const step = paragraphs.length / (images.length + 1)
  let img = 0
  paragraphs.forEach((text, i) => {
    out.push({ text })
    if (img < images.length && i + 1 >= Math.ceil(step * (img + 1))) {
      out.push({ image: images[img] })
      img += 1
    }
  })
  while (img < images.length) {
    out.push({ image: images[img] })
    img += 1
  }
  return out
}

/* ---------------- long-form article ---------------- */

function ArticlePage({ post }) {
  const related = articles.filter((item) => item.slug !== post.slug)
  const blocks = interleave(post.body || [], post.inlineImages)

  return (
    <>
      <PageHero
        eyebrow={post.category}
        title={post.title}
        image={RESOURCE_IMAGES[post.slug] || post.image}
        alt={post.imageAlt || `Editorial image accompanying: ${post.title}`}
      >
        {post.note}
      </PageHero>

      <section className="band-white section">
        <div className="shell article">
          <div className="article__body" data-reveal>
            {blocks.map((block, i) =>
              block.image ? (
                <figure className="article__figure" key={`img-${i}`} data-reveal="fade">
                  <img src={block.image.src} alt={block.image.alt} width="1500" height="1000" loading="lazy" decoding="async" />
                </figure>
              ) : (
                <p key={`p-${i}`}>{block.text}</p>
              )
            )}
          </div>
          <aside className="article__aside" data-reveal="fade">
            <p className="eyebrow eyebrow--accent">In this piece</p>
            <ul className="article__toc">
              {(post.body || []).map((paragraph, index) => (
                <li key={paragraph.slice(0, 40)}>
                  <span className="article__toc-num">{String(index + 1).padStart(2, '0')}</span>
                  {paragraph.split('. ')[0]}.
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </section>

      <section className="band-sage section" aria-labelledby="more-title">
        <div className="shell">
          <p className="eyebrow eyebrow--accent" id="more-title">
            Keep reading
          </p>
          <h2 className="h2">Two more worth your time.</h2>
          <div className="grid grid--2 notes-grid">
            {related.map((item) => (
              <Link className="card card--link" to={`/blog/${item.slug}`} key={item.slug} data-reveal="fade">
                <img className="resource-cover" src={RESOURCE_IMAGES[item.slug] || item.image} alt="" width="1500" height="1000" loading="lazy" decoding="async" />
                <span className="tag tag--moss">{item.category}</span>
                <h3 className="card__title">{item.title}</h3>
                <p className="card__body">{item.note}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <CtaBand
        title="Reading is done."
        accent="Now pick a state."
        body="The fastest way to know what applies to you is to choose your state and see the real requirements."
        primary={{ to: '/care', label: 'Start an intake' }}
        secondary={{ to: '/service', label: 'How it works' }}
      />
    </>
  )
}

/* ---------------- per-state guide ---------------- */

function StateGuidePage({ guide }) {
  const reviewed = formatReviewed(guide.reviewed)
  const fee = stateFees[guide.code]
  const note = stateNotes[guide.code]

  return (
    <>
      <PageHero
        eyebrow={guide.category}
        title={guide.title}
        image={guide.image}
        alt={guide.imageAlt}
      >
        {guide.note}
      </PageHero>

      <section className="band-white section">
        <div className="shell article">
          <div className="article__body" data-reveal>
            <p className="guide-meta">
              <span className={`tag ${STATUS_CLASS[guide.status] || 'tag--moss'}`}>{guide.status}</span>
              <span className="guide-meta__program">{guide.program}</span>
            </p>

            {fee ? (
              <p className="guide-callout">
                <strong>Fees. </strong>
                {fee}
              </p>
            ) : null}

            {note ? (
              <p className="guide-callout guide-callout--muted">
                <strong>Worth knowing. </strong>
                {note}
              </p>
            ) : null}

            {guide.sections.map((section, i) => (
              <section className="guide-section" id={`article-section-${i + 1}`} key={section.heading}>
                <h2>{section.heading}</h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph.slice(0, 48)}>{paragraph}</p>
                ))}
                {guide.inlineImages?.[i] ? (
                  <figure className="article__figure" data-reveal="fade">
                    <img
                      src={guide.inlineImages[i].src}
                      alt={guide.inlineImages[i].alt}
                      width="1500"
                      height="1000"
                      loading="lazy"
                      decoding="async"
                    />
                  </figure>
                ) : null}
              </section>
            ))}
          </div>

          <aside className="article__aside" data-reveal="fade">
            <p className="eyebrow eyebrow--accent">In this guide</p>
            <ul className="article__toc">
              {guide.sections.map((section, index) => (
                <li key={section.heading}>
                  <span className="article__toc-num">{String(index + 1).padStart(2, '0')}</span>
                  <a href={`#article-section-${index + 1}`}>{section.heading}</a>
                </li>
              ))}
            </ul>

            {guide.sources?.length ? (
              <>
                <p className="eyebrow eyebrow--accent" style={{ marginTop: '2rem' }}>
                  Sources
                </p>
                <ul className="guide-sources">
                  {guide.sources.map((source) => (
                    <li key={source.url}>
                      <a href={source.url} target="_blank" rel="noopener noreferrer">
                        {source.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {reviewed ? <p className="guide-reviewed">Reviewed {reviewed}</p> : null}
          </aside>
        </div>
      </section>

      <CtaBand
        title="Rules are clear now."
        accent="Take the next step."
        body="Choose your state and we will show you what actually applies where you live."
        primary={{ to: '/care', label: 'Start an intake' }}
        secondary={{ to: '/blog', label: 'Back to the resource centre' }}
      />
    </>
  )
}

/* ---------------- index ---------------- */

export default function Blog() {
  const { slug } = useParams()
  const [query, setQuery] = useState('')

  const matches = useMemo(() => searchStateGuides(query), [query])

  if (slug) {
    const post = findResource(slug)
    // An unknown slug is a real 404, not an empty page.
    if (!post) return <NotFound />
    return isStateGuide(slug) ? <StateGuidePage guide={post} /> : <ArticlePage post={post} />
  }

  return (
    <>
      <PageHero
        eyebrow="Resource centre"
        title="Good questions."
        accent="Clearer answers."
        image="/assets/blog/telehealth-cover.webp"
        alt="Illustrative image of a patient at a desk in a video consultation with a clinician on a laptop. Not an actual MmjGreen clinician or patient."
      >
        Practical preparation guides and sourced medical cannabis card and caregiver rules for all 50 states and
        Washington DC.
      </PageHero>

      <section className="band-white section" aria-labelledby="index-title">
        <div className="shell">
          <h2 className="sr-only" id="index-title">
            All resources
          </h2>
          <div className="grid grid--3">
            {articles.map((item) => (
              <article className="card" key={item.slug} data-reveal="fade">
                <img className="resource-cover" src={RESOURCE_IMAGES[item.slug] || item.image} alt="" width="1500" height="1000" loading="lazy" decoding="async" />
                <span className="tag tag--moss">{item.category}</span>
                <h3 className="card__title">
                  <Link to={`/blog/${item.slug}`}>{item.title}</Link>
                </h3>
                <p className="card__body">{item.note}</p>
                <span className="card__foot">
                  <Link className="text-link" to={`/blog/${item.slug}`}>
                    Read the piece
                  </Link>
                </span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="band-sage section" id="state-guides" aria-labelledby="state-guides-title">
        <div className="shell">
          <p className="eyebrow eyebrow--accent">Patient and caregiver rules</p>
          <h2 className="h2" id="state-guides-title">
            Find your state guide.
          </h2>
          <p className="lede">
            Medical programs, limited access, and states without a statewide MMJ card program are clearly
            distinguished. Each guide links to its sources. These guides do not indicate where MmjGreen offers
            evaluations.
          </p>

          <div className="guide-search">
            <label htmlFor="state-guide-search">Search by state or abbreviation</label>
            <input
              id="state-guide-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Colorado or CO"
            />
          </div>

          <p role="status" className="guide-count">
            {matches.length} state guides
          </p>

          <div className="grid grid--3">
            {matches.map((guide) => (
              <article className="card" key={guide.slug} data-reveal="fade">
                <img className="resource-cover" src={guide.image} alt="" width="1500" height="1000" loading="lazy" decoding="async" />
                <span className={`tag ${STATUS_CLASS[guide.status] || 'tag--moss'}`}>{guide.status}</span>
                <h3 className="card__title">
                  <Link to={`/blog/${guide.slug}`}>{guide.title}</Link>
                </h3>
                <p className="card__body">{guide.note}</p>
                <span className="card__foot">
                  <Link className="text-link" to={`/blog/${guide.slug}`}>
                    Read {guide.state} rules
                  </Link>
                </span>
              </article>
            ))}
          </div>

          {matches.length === 0 ? (
            <p className="guide-empty">No state matches “{query}”. Try the full name or the two-letter code.</p>
          ) : null}
        </div>
      </section>

      <CtaBand
        title="Enough reading."
        accent="Let’s find your path."
        body="Choose your state and we will show you what actually applies where you live."
        primary={{ to: '/care', label: 'Start an intake' }}
        secondary={{ to: '/contact', label: 'Ask a question' }}
      />
    </>
  )
}