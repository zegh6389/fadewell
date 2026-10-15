import { Link } from 'react-router-dom'

import { PageHero, SectionHead, Checklist, CtaBand } from '../components/Page.jsx'
import { Icon } from '../components/Icons.jsx'
import { serviceStages, servicePromises } from '../lib/content.js'

/**
 * How it works.
 *
 * The five stages are the same list the pinned journey on the home page walks
 * through horizontally, set out here as a single readable column. Someone who
 * arrived from search wants the whole sequence at once, not a gesture.
 */
export default function Service() {
  return (
    <>
      <PageHero
        eyebrow="How it works"
        title="A short questionnaire."
        accent="Then a doctor call."
        image="/assets/care-conversation.webp"
        alt="Illustrative stock photograph of a doctor using a phone"
      >
        Sign up, complete the questionnaire in about 2 minutes, then speak with a doctor. Typically 10–15
        minutes in total, or up to 30 minutes for an in-depth conversation. State-required in-person
        visits, registration, and card issuance are separate.
      </PageHero>

      <section className="band-white section" aria-labelledby="stages-title">
        <div className="shell">
          <SectionHead
            eyebrow="Five simple steps"
            title="What actually happens,"
            accent="in what order."
            lede="Every stage is visible to you while it is happening. If something is waiting on you, you will be told exactly what."
          />

          <ol className="stages">
            {serviceStages.map((stage) => (
              <li className="stages__row" key={stage.num} data-reveal>
                <p className="stages__num">{stage.num}</p>
                <div className="stages__body">
                  <h3 className="h4">{stage.title}</h3>
                  <p className="card__body">{stage.body}</p>
                  {stage.reference && (
                    <Link className="text-link" to={stage.reference.to}>
                      {stage.reference.label} ↗
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="band-sage section" aria-labelledby="promises-title">
        <div className="shell">
          <SectionHead
            eyebrow="What we hold to"
            title="Four things that do"
            accent="not change."
            lede="These are the parts of the process that most often go wrong elsewhere. They are the parts we built the product around."
          />

          <div className="grid grid--4">
            {servicePromises.map((item) => (
              <article className="card" key={item.title} data-reveal="fade">
                <span className="icon-disc" aria-hidden="true">
                  <Icon name={item.icon} size={22} />
                </span>
                <h3 className="card__title">{item.title}</h3>
                <p className="card__body">{item.note}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="band-white section" aria-label="What to have ready">
        <div className="shell split">
          <div data-reveal="fade">
            <p className="eyebrow eyebrow--accent">Before you start</p>
            <h2 className="h2">
              Have these ready and
              <span className="serif grad-text"> nothing slows you down.</span>
            </h2>
            <p className="lede">
              Almost every delay in this process comes from missing identification rather than anything clinical.
            </p>
            <Link className="btn btn--forest" to="/patient-info">
              Read the full patient guide
            </Link>
          </div>
          <Checklist
            items={[
              'Current government-issued photo ID',
              'Proof of residency, if your state requires it',
              'A list of your current medications',
              'Your existing card, if you are renewing'
            ]}
          />
        </div>
      </section>

      <CtaBand
        title="Start where you"
        accent="actually are."
        body="Choose your state and we will show you the path that applies to you. A clinician, not this website, decides eligibility."
        primary={{ to: '/patient', label: 'Start an intake' }}
        secondary={{ to: '/contact', label: 'Ask a question' }}
      />
    </>
  )
}
