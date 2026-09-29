import { useEffect, useMemo, useState } from 'react'
import { conditions } from '../lib/content.js'
import { PageHero, SectionHead, CtaBand, Checklist } from '../components/Page.jsx'
import { IconCheck, IconArrow } from '../components/Icons.jsx'
import { MagneticLink } from '../components/Chrome.jsx'
import { getJurisdictions } from '../lib/api.js'

const disclaimers = [
  'Qualifying conditions differ by state. We verify yours against live jurisdiction data before you start.',
  'A card does not give you access to anything — it removes the legal risk of the products your clinician has already discussed with you.',
  'Cannabis is not appropriate for everyone and interacts with some medications. Your clinician will always ask about this.'
]

export default function Care() {
  const [jurisdictions, setJurisdictions] = useState([])
  const [state, setState] = useState('')

  // Jurisdiction list comes from the live API when it is reachable. A marketing
  // page must never depend on it, so failure is silent and the copy stands alone.
  useEffect(() => {
    let cancelled = false
    getJurisdictions({ timeout: 6000 })
      .then((data) => {
        if (!cancelled && Array.isArray(data?.jurisdictions)) setJurisdictions(data.jurisdictions)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const active = useMemo(() => {
    if (!state || !jurisdictions.length) return null
    return jurisdictions.find((j) => j.code === state) ?? null
  }, [state, jurisdictions])

  return (
    <>
      <PageHero
        eyebrow="What we treat"
        title="Qualifying conditions,"
        accent="in the states we serve."
        lede="A medical card exists so that cannabis can be used without the legal risk that comes with it. These are the conditions our clinicians most often evaluate — your state decides which of them actually qualify."
      />

      <section className="section" aria-labelledby="cond-title">
        <div className="shell">
          <SectionHead
            id="cond-title"
            eyebrow="Commonly evaluated"
            title="What people come to us"
            accent="about."
          />
          <div className="spotlight-grid spotlight-grid--2">
            {conditions.map((item) => (
              <article className="spotlight-cell" key={item.title} data-reveal>
                <span className="tag tag--forest">{item.tag}</span>
                <h3 className="h4 card__title">{item.title}</h3>
                <p className="card__body">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="band-sage section" aria-labelledby="check-title">
        <div className="shell">
          <div className="split split--flip">
            <div className="split__body" data-reveal="left">
              <p className="eyebrow eyebrow--accent">Step one, always</p>
              <h2 className="h2" id="check-title">
                Your state decides
                <span className="serif"> what counts.</span>
              </h2>
              <p className="lede">
                Two people with the same condition can have completely different legal options depending
                on where they live. That is why FadeWell checks your jurisdiction before you answer a
                single question.
              </p>
              <Checklist items={disclaimers} />
            </div>

            <div className="card" data-reveal="right">
              <p className="card__num">JURISDICTION</p>
              <h3 className="card__title">Check your state</h3>
              <p className="card__body">
                Select your state to see whether FadeWell currently serves it.
              </p>

              <label className="field">
                <span className="field__label">State or territory</span>
                <select
                  className="field__control"
                  value={state}
                  onChange={(event) => setState(event.target.value)}
                >
                  <option value="">Select a state…</option>
                  {jurisdictions.map((j) => (
                    <option key={j.code} value={j.code}>
                      {j.name}
                    </option>
                  ))}
                </select>
              </label>

              {active ? (
                <div className="notice notice--ok" role="status">
                  <strong>{active.name}</strong>
                  <p>
                    {active.comingSoon
                      ? 'We are not accepting new patients here yet — join the waitlist and we will contact you.'
                      : 'We are accepting new patients here. Start an intake and we will apply the rules that apply to you.'}
                  </p>
                </div>
              ) : null}

              <MagneticLink to="/patient" className="btn btn--primary btn--block">
                Start your intake
                <IconArrow size={16} />
              </MagneticLink>
            </div>
          </div>
        </div>
      </section>

      <CtaBand
        title="Not sure if you qualify?"
        accent="Ask anyway."
        body="Our clinicians will tell you honestly at your evaluation — including when the answer is that a card is not the right path for you."
      />
    </>
  )
}
