import { Link, useParams } from 'react-router-dom'

import { PageHero, CtaBand } from '../components/Page.jsx'
import { clinicians } from '../lib/content.js'
import NotFound from './NotFound.jsx'

/**
 * A single clinician.
 *
 * Lives at `/clinicians/:slug` and deliberately sits outside `/clinicians`
 * rather than replacing it, so a shared link to one profile keeps working.
 *
 * The "photo" is an abstract monogram composition, not a portrait. The team
 * chose that on purpose: a photorealistic face for a clinician who does not
 * exist is the kind of thing that should not be sitting on a medical page next
 * to a real booking flow.
 */
export default function ClinicianProfile() {
  const { slug } = useParams()
  const person = clinicians.find((item) => item.slug === slug)
  if (!person) return <NotFound />

  const others = clinicians.filter((item) => item.slug !== person.slug)

  return (
    <>
      <PageHero eyebrow="Clinical standards" title={person.name} accent={person.role}>
        {person.bio}
      </PageHero>

      <section className="band-white section" aria-label="Profile">
        <div className="shell profile">
          <div className="profile__art" data-reveal="scale">
            <img
              src={person.photo}
              alt={`Abstract MmjGreen portrait marking for ${person.name}`}
              width="720"
              height="900"
              loading="lazy"
              decoding="async"
            />
          </div>

          <dl className="profile__facts" data-reveal="fade">
            <div>
              <dt>Role</dt>
              <dd>{person.role}</dd>
            </div>
            <div>
              <dt>Licensed in</dt>
              <dd>{person.states}</dd>
            </div>
            <div>
              <dt>Years practising</dt>
              <dd>{person.years}</dd>
            </div>
            <div>
              <dt>Languages</dt>
              <dd>{person.languages.join(', ')}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="band-sage section" aria-labelledby="independence-title">
        <div className="shell split">
          <div data-reveal="fade">
            <p className="eyebrow eyebrow--accent">How decisions are made</p>
            <h2 className="h2" id="independence-title">
              The clinician decides,
              <span className="serif grad-text"> every time.</span>
            </h2>
            <p className="lede">
              Nothing in our system recommends an outcome, ranks a clinician, or attaches a target to a
              consultation. The evaluation is a medical judgement about a specific person, and that is the one
              part of this process we refuse to automate.
            </p>
            <Link className="btn btn--forest" to="/care">
              Start an intake
            </Link>
          </div>
          <ul className="checklist" data-reveal>
            {[
              'No quotas or targets attached to a consultation',
              'No upselling of additional services during a visit',
              'An independent decision, recorded with a full audit trail',
              'A state-specific review, not a national template'
            ].map((item) => (
              <li key={item}>
                <span className="checklist__tick" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="band-white section" aria-labelledby="others-title">
        <div className="shell">
          <h2 className="h2" id="others-title">
            The rest of the team.
          </h2>
          <div className="grid grid--3">
            {others.map((item) => (
              <Link className="card card--link" to={`/clinicians/${item.slug}`} key={item.slug} data-reveal="fade">
                <h3 className="card__title">{item.name}</h3>
                <p className="card__body">{item.role}</p>
                <span className="text-link">View profile</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <CtaBand
        title="Ready when"
        accent="you are."
        body="Choose your state and book a consultation. You can pick video or phone, and you can change it."
        primary={{ to: '/care', label: 'Start an intake' }}
        secondary={{ to: '/clinicians', label: 'Meet the team' }}
      />
    </>
  )
}
