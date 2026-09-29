import { Link } from 'react-router-dom'
import { legalDocs, accessibility } from '../lib/content.js'
import { CtaBand } from '../components/Page.jsx'
import { IconClock } from '../components/Icons.jsx'

const documents = [
  { slug: 'privacy-policy', kind: 'privacy', label: 'Privacy policy' },
  { slug: 'terms-conditions', kind: 'terms', label: 'Terms of service' },
  { slug: 'refund-policy', kind: 'refund', label: 'Refund policy' },
  { slug: 'telehealth-consent', kind: 'telehealth', label: 'Telehealth consent' },
  { slug: 'medical-disclaimer', kind: 'medicalDisclaimer', label: 'Medical disclaimer' },
  { slug: 'accessibility', kind: 'accessibility', label: 'Accessibility' }
]

function resolveDoc(kind) {
  return kind === 'accessibility' ? accessibility : legalDocs[kind]
}

export default function Legal({ kind = 'privacy' }) {
  const doc = resolveDoc(kind)
  if (!doc) return null

  return (
    <>
      <section className="page-hero">
        <div className="shell page-hero__inner">
          <p className="eyebrow eyebrow--accent" data-reveal="fade">
            Legal & policies
          </p>
          <h1 className="h1" data-reveal>
            {doc.title}
          </h1>
          <p className="hero__note" data-reveal="fade">
            <IconClock size={14} />
            Last updated {doc.updated}
          </p>
          <p className="lede" data-reveal>
            {doc.intro}
          </p>
        </div>
      </section>

      <section className="section section--tight">
        <div className="shell legal">
          <nav className="legal__toc" aria-label="Policy selection">
            <p className="footer__col-title">Documents</p>
            <ul className="legal__toc-list">
              {documents.map((doc) => (
                <li key={doc.slug}>
                  <Link
                    to={`/${doc.slug}`}
                    className={`legal__toc-link${doc.kind === kind ? ' is-active' : ''}`}
                    aria-current={doc.kind === kind ? 'page' : undefined}
                  >
                    {doc.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <article className="legal__doc prose">
            {doc.sections.map((section) => (
              <section key={section.h} className="legal__section">
                <h2 className="h4">{section.h}</h2>
                {section.p.map((paragraph) => (
                  <p key={paragraph.slice(0, 40)}>{paragraph}</p>
                ))}
              </section>
            ))}
          </article>
        </div>
      </section>

      <CtaBand
        title="Something here unclear?"
        accent="Ask us."
        body="Legal copy is written to be understood, not just to be defensible. If a section does not make sense to you, tell us and we will explain it properly."
        secondary={{ label: 'Contact us', to: '/contact' }}
      />
    </>
  )
}
