import { journey, storySteps, faqs, brand } from '../lib/content.js'
import { PageHero, SectionHead, CtaBand, Checklist } from '../components/Page.jsx'
import { Icon, IconCheck } from '../components/Icons.jsx'

const reassurance = [
  'No account or password to remember — your secure link is the key',
  'You choose video or phone, whichever you are more comfortable with',
  'Reschedule free of charge up to 24 hours before your visit',
  'Reminders by email and text so you never miss a slot',
  'A named care coordinator if anything needs sorting out',
  'Free re-evaluation within 90 days if an application is denied'
]

export default function HowItWorks() {
  return (
    <>
      <PageHero
        eyebrow="How it works"
        title="From a six-minute form to a card in your wallet."
        lede="No waiting rooms, no phone trees, no guessing. Here is the entire process, in the order it actually happens — including the parts most services leave out."
      />

      <section className="section" aria-labelledby="steps-title">
        <div className="shell">
          <SectionHead
            id="steps-title"
            eyebrow="The five steps"
            title="Everything that happens,"
            accent="in order."
          />

          <div className="story">
            <div className="story__rail">
              <p className="lede" data-reveal>
                Each step has a real person responsible for it. If any of them stalls, you are told
                rather than left waiting.
              </p>
              <div className="story__rail-line" aria-hidden="true" />
            </div>

            <div className="story__steps">
              {journey.map((item) => (
                <article className="story__step" key={item.step} data-reveal>
                  <p className="story__step-num">{item.step}</p>
                  <span className="journey__icon">
                    <Icon name={item.icon} size={24} />
                  </span>
                  <h3 className="h4">{item.title}</h3>
                  <p className="card__body">{item.body}</p>
                  <p className="float-card__meta">{item.detail}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="band-light section" aria-labelledby="reassure-title">
        <div className="shell on-light">
          <div className="split">
            <div className="split__body" data-reveal="left">
              <p className="eyebrow eyebrow--accent">What you can count on</p>
              <h2 className="h2" id="reassure-title">
                The small things,
                <span className="serif"> done properly.</span>
              </h2>
              <p className="lede">
                Nobody sets out to make this difficult. It is just what happens when a process was not
                designed around the person living it. These are the specifics we have fixed.
              </p>
              <Checklist items={reassurance} />
            </div>

            <div className="card" data-reveal="right">
              <p className="card__num">TIMELINE</p>
              <h3 className="card__title">A realistic week</h3>
              <ul className="plan__list">
                {[
                  ['Day 0', 'Questionnaire completed, jurisdiction checked'],
                  ['Day 0–3', 'Clinician reviews your intake and confirms a slot'],
                  ['Day 4', 'Live consultation, typically 20 minutes'],
                  ['Day 4–7', 'Application prepared and filed with your registry'],
                  ['Day 7–21', 'We track the application and keep you posted']
                ].map(([when, what]) => (
                  <li key={when}>
                    <IconCheck size={16} />
                    <span>
                      <strong className="stat__label">{when}</strong> — {what}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="float-card__meta" data-reveal="fade">
                State registry processing varies. We report the real position of your application rather
                than a guess.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="why-title">
        <div className="shell">
          <SectionHead
            id="why-title"
            eyebrow="Under the hood"
            title="Why the process is"
            accent="shaped this way."
          />
          <div className="grid grid--2">
            {storySteps.map((step) => (
              <article className="card" key={step.num} data-reveal>
                <p className="card__num">{step.num}</p>
                <h3 className="card__title">{step.title}</h3>
                <p className="card__body">{step.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <CtaBand
        title="Ready when you are."
        accent="No pressure."
        body={`The questionnaire takes about six minutes and you can stop at any point. Questions first? Call ${brand.phone}.`}
      />
    </>
  )
}
