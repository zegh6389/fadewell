import { faqs, brand } from '../lib/content.js'
import { PageHero, SectionHead, CtaBand, FaqList } from '../components/Page.jsx'
import { IconChat, IconMail, IconPhone } from '../components/Icons.jsx'

const stillStuck = [
  {
    icon: IconPhone,
    title: 'Call us',
    body: brand.phone,
    note: brand.hours,
    href: `tel:${brand.phoneHref}`
  },
  {
    icon: IconMail,
    title: 'Email us',
    body: brand.email,
    note: 'We reply within one business day',
    href: `mailto:${brand.email}`
  },
  {
    icon: IconChat,
    title: 'Ask before you start',
    body: 'Send a question',
    note: 'No account needed to ask',
    href: '/contact'
  }
]

export default function Faq() {
  return (
    <>
      <PageHero
        eyebrow="Questions"
        title="Answered properly,"
        accent="not vaguely."
        lede="If a question is not answered here, that is a gap on our side. Ask it and we will add it."
      />

      <section className="section" aria-labelledby="faq-title">
        <div className="shell">
          <SectionHead id="faq-title" eyebrow="Everything" title="The full list." />
          <FaqList items={faqs} />

          <div className="grid grid--3 faq-more" data-reveal>
            {stillStuck.map((item) => {
              const IconComponent = item.icon
              return (
                <a className="card faq-more__card" key={item.title} href={item.href}>
                  <span className="journey__icon">
                    <IconComponent size={20} />
                  </span>
                  <h3 className="h4 card__title">{item.title}</h3>
                  <p className="card__body">{item.body}</p>
                  <p className="float-card__meta">{item.note}</p>
                </a>
              )
            })}
          </div>
        </div>
      </section>

      <CtaBand
        title="Ready to stop reading?"
        accent="Probably."
        body="The questionnaire takes about 2 minutes. Signup, questionnaire, and the doctor call typically take 10–15 minutes, or up to 30 minutes for an in-depth conversation."
        secondary={{ label: 'Ask a question', to: '/contact' }}
      />
    </>
  )
}
