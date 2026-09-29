/**
 * "A question on your mind?" — composes a message for the reader to send
 * from their own email client.
 *
 * Nothing is transmitted server-side. The original MedCardAccess section worked
 * the same way and it is the right call here too: it avoids holding a queue of
 * medical-adjacent questions on a marketing page, and it keeps the reader in
 * control of what actually gets sent. The confirmation copy says so plainly
 * rather than implying the message has been delivered.
 */

import { useEffect, useRef, useState } from 'react'

import { support } from '../lib/content.js'

const MAX = 2000

export function QuerySection() {
  const questionRef = useRef(null)
  const receiptRef = useRef(null)
  const [question, setQuestion] = useState('')
  const [sent, setSent] = useState(null)

  // Move focus to the confirmation so the result is announced and reachable
  // without hunting for it after the form disappears.
  useEffect(() => {
    if (sent) receiptRef.current?.focus()
  }, [sent])

  const submit = (event) => {
    event.preventDefault()
    const field = questionRef.current
    if (field && !question.trim()) {
      field.setCustomValidity('Please enter your question.')
      field.reportValidity()
      return
    }
    const data = new FormData(event.currentTarget)
    setSent({
      name: String(data.get('name') ?? '').trim(),
      email: String(data.get('email') ?? '').trim(),
      question: question.trim()
    })
  }

  const mailto = sent
    ? `${support.mailto}?subject=${encodeURIComponent('FadeWell support question')}` +
      `&body=${encodeURIComponent(`${sent.question}\n\nName: ${sent.name || 'Not provided'}\nReply email: ${sent.email}`)}`
    : support.mailto

  return (
    <section className="band-sage section" id="ask" aria-labelledby="query-title">
      <div className="shell query">
        <div className="query__intro" data-reveal="fade">
          <p className="eyebrow eyebrow--accent">Contact the team</p>
          <h2 className="h2" id="query-title">
            A question on your mind?
          </h2>
          <p className="lede">
            Ask about the process, your state’s requirements, or getting started. Write it here, review it, then
            send it from your own email app.
          </p>
          <p className="query__direct">
            Prefer to talk? <a className="text-link" href={support.tel}>{support.phone}</a>
            <br />
            Or email <a className="text-link" href={support.mailto}>{support.email}</a> directly.
          </p>
        </div>

        <div className="query__card card" data-reveal="scale">
          {sent ? (
            <div className="query__receipt">
              <span className="query__tick" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 12.5 4.5 4.5L19 7.5" />
                </svg>
              </span>
              <h3 className="h4" ref={receiptRef} tabIndex={-1}>
                Your question is ready.
              </h3>
              <p className="card__body">
                Nothing has been sent yet. Open your email app, check the message, and send it to us when you are
                happy with it.
              </p>
              <blockquote className="query__quote">{sent.question}</blockquote>
              <a className="btn btn--forest" href={mailto}>
                Open email app
              </a>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => {
                  setSent(null)
                  setQuestion('')
                }}
              >
                Write another
              </button>
            </div>
          ) : (
            <form className="query__form" onSubmit={submit} noValidate>
              <h3 className="h4">We’re here to help you understand.</h3>

              <div className="field">
                <label className="field__label" htmlFor="query-name">
                  Your name <span className="field__hint">(optional)</span>
                </label>
                <input
                  className="field__control"
                  id="query-name"
                  name="name"
                  autoComplete="name"
                  maxLength={100}
                />
              </div>

              <div className="field">
                <label className="field__label" htmlFor="query-email">
                  Email address
                </label>
                <input
                  className="field__control"
                  id="query-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                />
              </div>

              <div className="field">
                <label className="field__label" htmlFor="query-question">
                  Your question
                </label>
                <textarea
                  className="field__control field__control--area"
                  id="query-question"
                  ref={questionRef}
                  name="question"
                  rows={5}
                  maxLength={MAX}
                  required
                  aria-describedby="query-hint"
                  value={question}
                  onChange={(event) => {
                    event.target.setCustomValidity('')
                    setQuestion(event.target.value)
                  }}
                />
                <p className="field__hint" id="query-hint">
                  Please leave personal medical details out of this form. The intake is the right place for those.
                </p>
              </div>

              <button className="btn btn--forest" type="submit">
                Prepare my email
              </button>
              <p className="query__note">
                You review and send the message yourself. Nothing is delivered automatically.
              </p>
            </form>
          )}
        </div>
      </div>
    </section>
  )
}
