import { Link, useParams } from 'react-router-dom'

import { PageHero, CtaBand } from '../components/Page.jsx'
import { learningResources } from '../lib/content.js'
import NotFound from './NotFound.jsx'
import { RESOURCE_IMAGES } from '../components/PremiumHero.jsx'

/**
 * Resource centre. Handles both `/blog` and `/blog/:slug`.
 *
 * One component rather than two, because an article is the same thing as an
 * index entry with its body expanded — and keeping them together means a piece
 * cannot be added to the index without also being reachable.
 *
 * The articles are static prose in `content.js` rather than a fetched feed.
 * For a handful of genuinely fixed, genuinely useful pieces, a static document
 * is more durable than a CMS dependency, and it means the page works with no
 * API reachable.
 */

const COVERS = RESOURCE_IMAGES

export default function Blog() {
  const { slug } = useParams()
  const post = slug ? learningResources.find((item) => item.slug === slug) : null

  // An unknown slug is a real 404, not an empty article.
  if (slug && !post) return <NotFound />

  if (post) {
    const related = learningResources.filter((item) => item.slug !== post.slug)
    return (
      <>
        <PageHero
          eyebrow={post.category}
          title={post.title}
          image={COVERS[post.slug]}
          alt={`Editorial image accompanying: ${post.title}`}
        >
          {post.note}
        </PageHero>

        <section className="band-white section">
          <div className="shell article">
            <div className="article__body" data-reveal>
              {post.body.map((paragraph) => (
                <p key={paragraph.slice(0, 40)}>{paragraph}</p>
              ))}
            </div>
            <aside className="article__aside" data-reveal="fade">
              <p className="eyebrow eyebrow--accent">In this piece</p>
              <ul className="article__toc">
                {post.body.map((paragraph, index) => (
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
                  <img className="resource-cover" src={COVERS[item.slug]} alt="" width="1000" height="667" loading="lazy" decoding="async" />
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

  return (
    <>
      <PageHero
        eyebrow="Resource centre"
        title="Good questions."
        accent="Clearer answers."
        image="/assets/botanical-leaves.webp"
        alt="Green plants accompanying the MmjGreen patient resource centre"
      >
        Original, plain-language writing about the parts of this process that people most often get wrong. No
        promises about outcomes, because nobody can honestly make them.
      </PageHero>

      <section className="band-white section" aria-labelledby="index-title">
        <div className="shell">
          <h2 className="sr-only" id="index-title">
            All resources
          </h2>
          <div className="grid grid--3">
            {learningResources.map((item) => (
              <article className="card" key={item.slug} data-reveal="fade">
                <img className="resource-cover" src={COVERS[item.slug]} alt="" width="1000" height="667" loading="lazy" decoding="async" />
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
