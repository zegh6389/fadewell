import { values, timeline, stats, brand } from '../lib/content.js'
import { PageHero, SectionHead, CtaBand } from '../components/Page.jsx'
import { IconCheck } from '../components/Icons.jsx'

const facts = [
  'Founded in Denver, Colorado in 2022',
  `Clinical and operations staff based in ${brand.address.split(',')[1]?.trim() ?? 'Colorado'}`,
  'Independent — no dispensary ownership or affiliate revenue',
  'Serving fourteen states and expanding only where clinicians are licensed'
]

export default function About() {
  return (
    <>
      <PageHero
        eyebrow="About FadeWell"
        title="We build the paperwork"
        accent="so you can do the talking."
        lede="FadeWell exists because getting a medical card is mostly administrative, and nobody has ever enjoyed the administrative part. We did not set out to reinvent medicine — we set out to remove everything standing between a person and a conversation with a clinician."
      />

      <section className="section" aria-labelledby="origin-title">
        <div className="shell">
          <div className="split">
            <div className="split__body" data-reveal="left">
              <p className="eyebrow eyebrow--accent">Why we exist</p>
              <h2 className="h2" id="origin-title">
                It started with a
                <span className="serif grad-text"> clipboard.</span>
              </h2>
              <p className="lede">
                Our founders are clinicians. They kept watching qualified patients — people with chronic
                pain, with PTSD, with insomnia that had lasted years — give up because the process was
                too confusing. Forms asked for information their state did not need. Providers could not
                see the history that had already been collected. Nobody could tell them where their
                application had got to.
              </p>
              <p className="lede">
                None of that is clinical. All of it was fixable. So we built the system we wanted to be
                treated by: jurisdiction-aware, transparent about status, and ruthless about not asking
                for anything twice.
              </p>
              <ul className="checklist">
                {facts.map((fact) => (
                  <li key={fact}>
                    <IconCheck size={16} />
                    {fact}
                  </li>
                ))}
              </ul>
            </div>

            <div className="split__media" data-reveal="right">
              <img
                src="/assets/about-studio.webp"
                alt="The FadeWell clinical operations studio, with clinicians reviewing an evaluation together"
                loading="lazy"
                width="1200"
                height="900"
              />
              <span className="" aria-hidden="true" />
            </div>
          </div>
        </div>
      </section>

      <section className="band-sage section" aria-labelledby="values-title">
        <div className="shell">
          <SectionHead
            id="values-title"
            eyebrow="How we work"
            title="Four things we"
            accent="refuse to compromise."
          />
          <div className="grid grid--2">
            {values.map((value, index) => (
              <article className="card" key={value.title} data-reveal>
                <p className="card__num">{String(index + 1).padStart(2, '0')}</p>
                <h3 className="card__title">{value.title}</h3>
                <p className="card__body">{value.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="timeline-title">
        <div className="shell">
          <SectionHead
            id="timeline-title"
            eyebrow="So far"
            title="How we got"
            accent="here."
          />

          <ol className="timeline">
            {timeline.map((item) => (
              <li className="timeline__item" key={item.year} data-reveal>
                <span className="timeline__year">{item.year}</span>
                <div className="timeline__body">
                  <h3 className="h4">{item.title}</h3>
                  <p className="card__body">{item.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section--tight" aria-label="FadeWell by the numbers">
        <div className="shell">
          <div className="stats" data-reveal="scale">
            {stats.map((stat) => (
              <div className="stat" key={stat.label}>
                <span className="stat__value">
                  {typeof stat.value === 'number' ? stat.value.toLocaleString('en-US') : stat.value}
                  {stat.suffix}
                </span>
                <span className="stat__label">{stat.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CtaBand
        title="Come and see"
        accent="how it works."
        body="No commitment, no account. Just a six-minute questionnaire and an honest answer about whether we can help."
      />
    </>
  )
}
