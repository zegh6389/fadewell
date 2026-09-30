import { Link } from 'react-router-dom'

import { PageHero, SectionHead, Checklist, CtaBand } from '../components/Page.jsx'
import { guideSections, guideChecklist } from '../lib/content.js'

/**
 * The patient guide.
 *
 * Written as a readable document rather than a set of cards, because this is
 * the page people bookmark and come back to. Each section is a plain heading
 * and paragraphs, so it survives being printed or read aloud.
 */
export default function PatientInfo() {
  return (
    <>
      <PageHero
        eyebrow="Patient guide"
        title="Feel prepared."
        accent="One step at a time."
        image="/assets/page-patient-info.webp"
        alt="Illustration summarising what to bring to a MmjGreen evaluation"
      >
        Know what to bring, what your clinician will review, and what happens after your visit. Written for
        people doing this for the first time, and for people renewing who want to know what has changed.
      </PageHero>

      <section className="band-white section" aria-labelledby="checklist-title">
        <div className="shell split split--wide">
          <div data-reveal="fade">
            <p className="eyebrow eyebrow--accent">The short version</p>
            <h2 className="h2" id="checklist-title">
              Six things to
              <span className="serif grad-text"> have ready.</span>
            </h2>
            <p className="lede">
              If you only do one thing from this page, make it the first one. Missing identification is by far the
              most common reason a consultation gets rescheduled.
            </p>
            <Link className="btn btn--forest" to="/care">
              Start your intake
            </Link>
          </div>
          <Checklist items={guideChecklist} className="checklist checklist--boxed" />
        </div>
      </section>

      {guideSections.map((section, index) => {
        // Alternating bands. Written as a full literal rather than
        // `band-${...}` so the class audit can still verify the names exist.
        const band = index % 2 === 0 ? 'band-white' : 'band-sage'
        return (
        <section
          key={section.title}
          className={`${band} section`}
          aria-labelledby={`guide-${index}`}
        >
          <div className="shell guide">
            <div className="guide__head" data-reveal="fade">
              <p className="eyebrow eyebrow--accent">
                {String(index + 1).padStart(2, '0')} / {String(guideSections.length).padStart(2, '0')}
              </p>
              <h2 className="h2" id={`guide-${index}`}>
                {section.title}
              </h2>
            </div>
            <div className="guide__body" data-reveal>
              {section.body.map((paragraph) => (
                <p key={paragraph.slice(0, 40)}>{paragraph}</p>
              ))}
            </div>
          </div>
        </section>
        )
      })}

      <section className="band-white section" aria-labelledby="more-title">
        <div className="shell">
          <SectionHead
            eyebrow="Going further"
            title="More detail on the"
            accent="questions we get most."
            lede="Three longer pieces covering the parts people most often get caught out by."
          />
          <div className="grid grid--3">
            {['preparing-for-your-evaluation', 'certification-is-not-a-state-card', 'what-changes-when-you-renew'].map(
              (slug) => (
                <Link className="card card--link" to={`/blog/${slug}`} key={slug} data-reveal="fade">
                  <span className="card__num">Read</span>
                  <h3 className="card__title">
                    {slug === 'preparing-for-your-evaluation' && 'What to prepare for an online evaluation'}
                    {slug === 'certification-is-not-a-state-card' && 'Certification is not a state card'}
                    {slug === 'what-changes-when-you-renew' && 'What changes when you renew'}
                  </h3>
                  <span className="text-link">Read the piece</span>
                </Link>
              )
            )}
          </div>
        </div>
      </section>

      <CtaBand
        eyebrow="Ready when you are"
        title="You know more"
        accent="than you think."
        body="The intake takes about six minutes and you can stop and come back. No account, no password."
        primary={{ to: '/care', label: 'Start an intake' }}
        secondary={{ to: '/service', label: 'See how it works' }}
      />
    </>
  )
}
