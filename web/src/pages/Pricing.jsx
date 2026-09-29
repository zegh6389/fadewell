import { plans, pricingNotes, faqs } from '../lib/content.js'
import { PageHero, SectionHead, CtaBand, FaqList, Checklist } from '../components/Page.jsx'
import { IconArrow } from '../components/Icons.jsx'
import { MagneticLink } from '../components/Chrome.jsx'

const priceFaqs = faqs.filter((item) =>
  /refund|denied|state application|subscription|price/i.test(item.q)
)

export default function Pricing() {
  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title="Published prices."
        accent="Nothing added later."
        lede="No membership, no hidden platform fee, no upsell at the end. What you see is what you pay, and we tell you exactly what your state charges separately."
      />

      <section className="section" aria-labelledby="plans-title">
        <div className="shell">
          <h2 className="sr-only" id="plans-title">
            Plans
          </h2>
          <div className="grid grid--3">
            {plans.map((plan, index) => (
              <article
                className={`plan${plan.featured ? ' plan--featured' : ''}`}
                key={plan.name}
                data-reveal
              >
                {plan.badge ? <span className="tag tag--moss plan__badge">{plan.badge}</span> : null}
                <h3 className="plan__name">{plan.name}</h3>
                <p className="plan__price">
                  ${plan.price}
                  <small>{plan.cadence}</small>
                </p>
                <p className="plan__desc">{plan.description}</p>
                <ul className="plan__list">
                  {plan.features.map((feature) => (
                    <li key={feature} className={index === 0 ? 'd-1' : undefined}>
                      <IconArrow size={14} className="plan__tick" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <MagneticLink
                  to={plan.cta.to}
                  className={`btn btn--block${plan.featured ? ' btn--primary' : ' btn--ghost'}`}
                >
                  {plan.cta.label}
                </MagneticLink>
              </article>
            ))}
          </div>

          <div className="card pricing-notes" data-reveal>
            <p className="card__num">THE FINE PRINT, IN LARGE TYPE</p>
            <Checklist items={pricingNotes} />
          </div>
        </div>
      </section>

      <section className="band-sage section" aria-labelledby="value-title">
        <div className="shell">
          <div className="split">
            <div className="split__body" data-reveal="left">
              <p className="eyebrow eyebrow--accent">Why it is this cheap</p>
              <h2 className="h2" id="value-title">
            We do not pay for your card.
              </h2>
              <p className="lede">
                Plenty of card services are funded by dispensaries who then want your business. FadeWell
                is not affiliated with any dispensary, and we do not take a cut of what you spend
                anywhere. The clinician evaluates you; nothing else is being sold.
              </p>
            </div>
            <ul className="plan__list" data-reveal="right">
              {[
                'No dispensary partnerships or affiliate revenue',
                'No referral commission from anywhere you might spend',
                'No upsell to consultations, products or prescriptions',
                'Priced to cover the clinician, the platform and the filings'
              ].map((item) => (
                <li key={item}>
                  <IconArrow size={14} className="plan__tick" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="price-faq-title">
        <div className="shell">
          <SectionHead
            id="price-faq-title"
            eyebrow="Money questions"
            title="The ones people actually ask."
          />
          <FaqList items={priceFaqs.length ? priceFaqs : faqs.slice(0, 4)} />
        </div>
      </section>

      <CtaBand
        title="Start when it suits you."
        accent="Nothing is charged yet."
        body="Book your evaluation first. You are only charged once your appointment is confirmed."
      />
    </>
  )
}
