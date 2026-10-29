/**
 * Clinical standards.
 *
 * Rebuilt from the production bundle that shipped to Vercel on 2026-10-14. The
 * production build removed public clinician profiles entirely — this page used
 * to name four practitioners, portraits and licences, and the rest of the site
 * now states plainly that no clinician names, portraits or biographies are
 * published. Keep them in step: if a name reappears anywhere, the home page and
 * this page start contradicting each other.
 */

import { brand, evaluationStandards } from '../lib/content.js'
import { PageHero, SectionHead, CtaBand } from '../components/Page.jsx'
import { IconCheck } from '../components/Icons.jsx'

export default function Clinicians() {
  return (
    <>
      <PageHero
        eyebrow="Clinical standards"
        title="Real clinical care."
        accent="A private conversation."
        image="/assets/care-preparation.webp"
        alt="Preparing documents for a private medical evaluation"
        lede="A licensed clinician reviews your questionnaire and talks with you. Here is what to expect from that evaluation."
      />

      <section className="section" aria-labelledby="standards-title">
        <div className="shell">
          <SectionHead
            id="standards-title"
            eyebrow="Your evaluation"
            title="Clear standards,"
            accent="without public profiles."
          />

          <div className="grid grid--2">
            {evaluationStandards.map((standard) => (
              <article className="card" key={standard.title} data-reveal>
                <IconCheck size={24} />
                <h3 className="card__title">{standard.title}</h3>
                <p className="card__body">{standard.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="band-sage section">
        <div className="shell split">
          <div data-reveal>
            <p className="eyebrow eyebrow--accent">The clinician decides</p>
            <h2 className="h2">
              Your health deserves <span className="serif">individual attention.</span>
            </h2>
            <p className="lede">
              Your answers support a conversation, not an automatic approval. Your clinician explains the
              decision and any state requirements that apply. If approved, state registration or card
              issuance may still be required.
            </p>
          </div>

          <div className="card" data-reveal>
            <h3 className="card__title">Before the call</h3>
            <p className="card__body">
              Have your photo ID, relevant medical history, and questions ready. Your clinician
              identifies themselves during your care interaction. For help arranging the visit or
              checking state availability, contact our care team.
            </p>
          </div>
        </div>
      </section>

      <CtaBand
        title="A short questionnaire."
        accent="Then a real conversation."
        body={`Start with your state and contact details. Questions first? Call ${brand.phone}.`}
      />
    </>
  )
}