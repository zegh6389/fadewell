import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { PageHero, CtaBand, HeroArt } from '../components/Page.jsx'
import { RESOURCE_IMAGES } from '../components/PremiumHero.jsx'
import NotFound from './NotFound.jsx'
import { articles, stateGuides, allResources, findResource } from '../lib/resourceCentre.js'

/**
 * Resource centre. Handles `/blog` and `/blog/:slug`.
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

/** The article index is its own screen; both article kinds share this one. */
function BlogIndex() {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const matches = stateGuides.filter((guide) =>
    `${guide.state} ${guide.code}`.toLowerCase().includes(needle)
  )

  return (
    <div className="blog-page">
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
                <HeroArt
                  className="resource-cover"
                  src={coverFor(item)}
                  alt=""
                  width="1500"
                  height="1000"
                  loading="lazy"
                  decoding="async"
                />
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

          <div className="field">
            <label htmlFor="state-guide-search">Search by state or abbreviation</label>
            <input
              id="state-guide-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Colorado or CO"
            />
          </div>

          <p role="status">{matches.length} state guides</p>

          <div className="grid grid--3">
            {matches.map((guide) => (
              <article className="card" key={guide.slug}>
                <HeroArt
                  className="resource-cover"
                  src={coverFor(guide)}
                  alt={guide.imageAlt}
                  width="1500"
                  height="1000"
                  loading="lazy"
                  decoding="async"
                />
                <span className="tag tag--moss">{guide.status}</span>
                <h3 className="card__title">
                  <Link to={`/blog/${guide.slug}`}>{guide.title}</Link>
                </h3>
                <p className="card__body">{guide.note}</p>
                <Link className="text-link" to={`/blog/${guide.slug}`}>
                  Read {guide.state} rules
                </Link>
              </article>
            ))}
          </div>

          {matches.length === 0 ? <p>No matching state. Try the full name or its two letter abbreviation.</p> : null}
        </div>
      </section>

      <CtaBand
        title="Enough reading."
        accent="Let’s find your path."
        body="Choose your state and we will show you what actually applies where you live."
        primary={{ to: '/patient', label: 'Start an intake' }}
        secondary={{ to: '/contact', label: 'Ask a question' }}
      />
    </div>
  )
}

/* ---------------- long-form article and state guide -------------- */

/** Article covers fall back to the shared map when a record has no image. */
function coverFor(item) {
  return item.image || RESOURCE_IMAGES[item.slug]
}

const sectionId = (index) => `article-section-${index + 1}`

/**
 * Picks which inline figure belongs to which section.
 *
 * A guide can have many sections and two figures. The figures land after the
 * second and third, or after the first and last when there are four or fewer,
 * so the article never opens with art and never ends on one.
 */
function figureFor(images, index, total) {
  if (!images?.length) return null
  const slot = (total >= 5 ? [1, 3] : [1, total - 1]).indexOf(index)
  return slot === -1 ? null : images[slot]
}

function ArticlePage({ post }) {
  const related = allResources
    .filter((item) => item.slug !== post.slug && item.category === post.category)
    .slice(0, 2)
  const sections =
    post.sections || post.body.map((text, index) => ({ heading: `Part ${index + 1}`, paragraphs: [text] }))

  return (
    <div className="blog-page">
      <PageHero
        eyebrow={post.category}
        title={post.title}
        image={coverFor(post)}
        alt={post.imageAlt || `Editorial image accompanying: ${post.title}`}
      >
        {post.note}
      </PageHero>

      <section className="band-white section">
        <div className="shell article">
          <div className="article__body" data-reveal>
            {post.state ? (
              <>
                <p>
                  <span className="tag tag--moss">{post.status}</span>
                </p>
                <p>
                  Source review: <time dateTime={post.reviewed}>September 30, 2026</time>. State law and program
                  availability are separate from MmjGreen service coverage. Check current official requirements before
                  applying.
                </p>
              </>
            ) : null}

            {sections.map((section, index) => {
              const figure = figureFor(post.inlineImages, index, sections.length)
              return (
                <section id={sectionId(index)} key={section.heading}>
                  {post.sections ? <h2 className="h4">{section.heading}</h2> : null}
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  {figure ? (
                    <figure className="article-media">
                      <img
                        src={figure.src}
                        alt={figure.alt}
                        width="1500"
                        height="1000"
                        loading="lazy"
                        decoding="async"
                      />
                    </figure>
                  ) : null}
                </section>
              )
            })}

            {post.sources ? (
              <section id="article-sources">
                <h2 className="h4">Sources and current program instructions</h2>
                <ul>
                  {post.sources.map((source) => (
                    <li key={source.url}>
                      <a className="text-link" href={source.url} target="_blank" rel="noreferrer">
                        {source.label}
                      </a>
                    </li>
                  ))}
                </ul>
                <p>
                  This guide explains the patient and caregiver pathways. It is educational information, not an
                  individual eligibility decision or an exhaustive account of state law.
                </p>
                <Link className="text-link" to="/blog#state-guides">
                  Browse all state guides
                </Link>
              </section>
            ) : null}
          </div>

          <aside className="article__aside" data-reveal="fade">
            <p className="eyebrow eyebrow--accent">In this piece</p>
            <ul className="article__toc">
              {sections.map((section, index) => (
                <li key={section.heading}>
                  <span className="article__toc-num">{String(index + 1).padStart(2, '0')}</span>
                  <a href={`#${sectionId(index)}`}>
                    {post.sections ? section.heading : section.paragraphs[0].split('. ')[0]}
                  </a>
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
          <h2 className="h2">More worth your time.</h2>
          <div className="grid grid--2 notes-grid">
            {related.map((item) => (
              <Link className="card card--link" to={`/blog/${item.slug}`} key={item.slug} data-reveal="fade">
                <HeroArt
                  className="resource-cover"
                  src={coverFor(item)}
                  alt=""
                  width="1500"
                  height="1000"
                  loading="lazy"
                  decoding="async"
                />
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
        primary={{ to: '/patient', label: 'Start an intake' }}
        secondary={{ to: '/service', label: 'How it works' }}
      />
    </div>
  )
}

export default function Blog() {
  const { slug } = useParams()
  const post = slug ? findResource(slug) : null

  if (slug && !post) return <NotFound />
  if (!slug) return <BlogIndex />
  return <ArticlePage post={post} />
}