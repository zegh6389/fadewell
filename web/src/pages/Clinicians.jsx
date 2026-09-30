import { clinicians, brand } from '../lib/content.js'
import { PageHero, SectionHead, CtaBand } from '../components/Page.jsx'
import { IconBadge, IconCheck } from '../components/Icons.jsx'

const standards = [
  'Active, unrestricted licence in every state listed for each clinician',
  'Prescribing authority verified directly against the state board registry',
  'Annual re-credentialing and continuous licensure monitoring',
  'Malpractice cover and a documented scope of practice',
  'Ongoing clinical governance and adverse-event review'
]

export default function Clinicians() {
  return (
    <>
      <PageHero
        eyebrow="Our clinicians"
        title="You should know who is"
        accent="going to evaluate you."
        lede="Every MmjGreen evaluation is performed by an independently licensed clinician — never by a chatbot, and never by someone without the authority to certify your application."
      />

      <section className="section" aria-labelledby="team-title">
        <div className="shell">
          <SectionHead
            id="team-title"
            eyebrow="The team"
            title="Practitioners with"
            accent="actual authority."
          />

          <div className="grid grid--4">
            {clinicians.map((person) => (
              <article className="clinician" key={person.slug} data-reveal>
                <div className="clinician__photo">
                  <img src={person.photo} alt={`Portrait of ${person.name}`} loading="lazy" width="480" height="600" />
                  <span className="clinician__badge">{person.years} yrs</span>
                </div>
                <div>
                  <p className="clinician__name">{person.name}</p>
                  <p className="clinician__role">{person.role}</p>
                </div>
                <p className="clinician__bio">{person.bio}</p>
                <div className="card__foot clinician__foot">
                  <p className="float-card__meta">Licensed in</p>
                  <p className="float-card__title">{person.states}</p>
                  <p className="float-card__meta clinician__langs">
                    Languages: {person.languages.join(', ')}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="band-sage section" aria-labelledby="standards-title">
        <div className="shell">
          <div className="split">
            <div className="split__body" data-reveal="left">
              <p className="eyebrow eyebrow--accent">Credentialing</p>
              <h2 className="h2" id="standards-title">
                Licence means nothing
                <span className="serif"> unless we check it.</span>
              </h2>
              <p className="lede">
                Telehealth made it easy to practise somewhere you have never set foot. We verify every
                clinician against the board registry in each state they evaluate in, and we re-check
                continuously rather than once at onboarding.
              </p>
            </div>

            <ul className="plan__list" data-reveal="right">
              {standards.map((item) => (
                <li key={item}>
                  <IconCheck size={16} />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="section--tight" aria-label="Governance">
        <div className="shell">
          <div className="stats" data-reveal="scale">
            <div className="stat">
              <span className="stat__value">
                <IconBadge size={40} />
              </span>
              <span className="stat__label">Board-verified credentials in 14 states</span>
            </div>
            <div className="stat">
              <span className="stat__value">4.9/5</span>
              <span className="stat__label">Average patient rating</span>
            </div>
            <div className="stat">
              <span className="stat__value">20 min</span>
              <span className="stat__label">Typical consultation length</span>
            </div>
            <div className="stat">
              <span className="stat__value">24 hrs</span>
              <span className="stat__label">Median time to a booked slot</span>
            </div>
          </div>
        </div>
      </section>

      <CtaBand
        title="Pick a time,"
        accent="or ask us first."
        body={`We will match you with a clinician licensed where you live. Questions before you start? Call ${brand.phone}.`}
      />
    </>
  )
}
