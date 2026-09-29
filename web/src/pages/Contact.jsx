import { useState } from 'react'
import { contactReasons, brand } from '../lib/content.js'
import { PageHero, SectionHead } from '../components/Page.jsx'
import { IconArrow, IconMail, IconPhone, IconPin, IconCheck } from '../components/Icons.jsx'

const channels = [
  { icon: IconPhone, label: 'Phone', value: brand.phone, href: `tel:${brand.phoneHref}`, note: brand.hours },
  { icon: IconMail, label: 'Email', value: brand.email, href: `mailto:${brand.email}`, note: 'Replies within one business day' },
  { icon: IconPin, label: 'Address', value: brand.address, href: null, note: 'Clinical operations, not a walk-in clinic' }
]

export default function Contact() {
  const [sent, setSent] = useState(false)
  const [reason, setReason] = useState(contactReasons[0])

  function handleSubmit(event) {
    event.preventDefault()
    setSent(true)
  }

  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Ask us anything"
        accent="before you commit."
        lede="A real person reads every message. If you are not sure whether FadeWell is right for you, that is exactly the question we would rather you asked."
      />

      <section className="section" aria-labelledby="contact-title">
        <div className="shell">
          <h2 className="sr-only" id="contact-title">
            Contact FadeWell
          </h2>

          <div className="split split--flip">
            <div className="card" data-reveal="right">
              {sent ? (
                <div className="notice notice--ok" role="status">
                  <strong>Message received.</strong>
                  <p>
                    Thanks for writing. Someone from the care team will reply within one business day —
                    usually much sooner during opening hours.
                  </p>
                </div>
              ) : null}

              <form className="form" onSubmit={handleSubmit}>
                <h3 className="h4">Send us a message</h3>

                <label className="field">
                  <span className="field__label">What is this about?</span>
                  <select
                    className="field__control"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  >
                    {contactReasons.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span className="field__label">
                    Your name <span className="field__hint">(optional)</span>
                  </span>
                  <input className="field__control" name="name" type="text" autoComplete="name" maxLength={100} />
                </label>

                <label className="field">
                  <span className="field__label">Email</span>
                  <input className="field__control" name="email" type="email" autoComplete="email" required maxLength={254} />
                </label>

                <label className="field">
                  <span className="field__label">Message</span>
                  <textarea
                    className="field__control field__control--area"
                    name="message"
                    rows={6}
                    required
                    maxLength={2000}
                    placeholder="Tell us what you need to know. Please do not send medical details here — we will collect those securely once you start an intake."
                  />
                </label>

                <button type="submit" className="btn btn--primary btn--block">
                  Send message
                  <IconArrow size={16} />
                </button>

                <p className="float-card__meta">
                  <IconCheck size={14} /> We never use your message for marketing. If you want updates,
                  you can opt in separately.
                </p>
              </form>
            </div>

            <div className="split__body" data-reveal="left">
              <p className="eyebrow eyebrow--accent">Direct</p>
              <h2 className="h2">However suits you.</h2>
              <p className="lede">
                If you are in medical distress, do not use any of these channels. Call 911, or call or
                text 988 for a crisis response.
              </p>

              <ul className="contact-list">
                {channels.map((channel) => {
                  const IconComponent = channel.icon
                  const inner = (
                    <>
                      <span className="journey__icon contact-list__icon">
                        <IconComponent size={18} />
                      </span>
                      <span>
                        <span className="float-card__meta">{channel.label}</span>
                        <span className="contact-list__value">{channel.value}</span>
                        <span className="float-card__meta">{channel.note}</span>
                      </span>
                    </>
                  )
                  return (
                    <li key={channel.label}>
                      {channel.href ? (
                        <a className="contact-list__row" href={channel.href}>
                          {inner}
                        </a>
                      ) : (
                        <div className="contact-list__row">{inner}</div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="band-sage section" aria-labelledby="not-title">
        <div className="shell">
          <SectionHead
            id="not-title"
            eyebrow="Set expectations"
            title="What we can and"
            accent="cannot do here."
          />
          <div className="grid grid--2">
            <article className="card" data-reveal>
              <p className="card__num">WE CAN</p>
              <ul className="checklist">
                {[
                  'Answer questions about the process, cost and timelines',
                  'Tell you honestly whether we serve your state',
                  'Help you reschedule or sort out an existing application',
                  'Correct anything wrong in your record'
                ].map((item) => (
                  <li key={item}>
                    <IconCheck size={16} />
                    {item}
                  </li>
                ))}
              </ul>
            </article>
            <article className="card" data-reveal>
              <p className="card__num">WE CANNOT</p>
              <ul className="checklist">
                {[
                  'Give you a diagnosis or tell you that you qualify, before an evaluation',
                  'Issue a card — only your state registry does that',
                  'Provide emergency or crisis care',
                  'Advise you on medication changes. Speak to your prescriber first.'
                ].map((item) => (
                  <li key={item}>
                    <IconCheck size={16} />
                    {item}
                  </li>
                ))}
              </ul>
            </article>
          </div>
        </div>
      </section>
    </>
  )
}
