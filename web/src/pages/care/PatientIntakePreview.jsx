import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { IconArrow, IconCheck, IconClock, IconShield, IconVideo } from '../../components/Icons.jsx'
import { SampleCard } from '../../components/PremiumHero.jsx'

/**
 * Frontend-only intake preview.
 *
 * The intake questionnaire with every network call removed. It exists so the
 * public deployment can show the real flow without implying it can accept
 * anything: there is no session, no save, and no submit. The banner says so
 * in those words and the completion screen repeats it for screen readers.
 *
 * Markup mirrors the production build so `recovered.css` styles it exactly:
 * `.intake-card` is the tilted sample card in the companion column, not a
 * form container.
 */

const STEPS = [
  ['About you', 'Let’s start with you.', 'A few details so your care team can reach you.'],
  ['Your visit', 'Care that meets you where you are.', 'Choose your state and your preferred consultation format.'],
  ['Your health', 'Tell us your story.', 'Your answers help your clinician understand what matters to you.'],
  ['Your identity', 'A little peace of mind.', 'Confirm your age and add identification for your evaluation.'],
  ['Review', 'Your next chapter starts here.', 'Check your details and choose how we can keep you updated.']
]

const QUESTIONS = [
  { id: 'goals', label: 'What would you like to discuss with your clinician?' },
  { id: 'history', label: 'What medical history should your clinician know about?' },
  { id: 'medications', label: 'Which medications or supplements do you currently take?' },
  { id: 'allergies', label: 'Do you have any known allergies?' }
]

const SUGGESTIONS = {
  goals: ['Discuss symptom management', 'Discuss a renewal', 'Understand benefits and risks'],
  history: ['No medical history to report'],
  medications: ['None'],
  allergies: ['No known allergies']
}

const JURISDICTIONS = [
  ['CA', 'California'],
  ['CO', 'Colorado'],
  ['FL', 'Florida'],
  ['NY', 'New York']
].map(([code, name]) => ({ code, name, allowedVisitTypes: ['VIDEO', 'PHONE'] }))

const MODES = [
  { value: 'VIDEO', label: 'Video call', note: 'Face to face, from wherever you are' },
  { value: 'PHONE', label: 'Phone call', note: 'A clinician calls you' },
  { value: 'EITHER', label: 'Either is fine', note: 'Pick whatever is available first' }
]

const ID_TYPES = [
  ['DRIVERS_LICENSE', 'Driver licence'],
  ['PASSPORT', 'Passport'],
  ['STATE_ID', 'State ID']
]

const emptyForm = () => ({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  state: '',
  mode: '',
  idType: '',
  ageVerified: '',
  answers: Object.fromEntries(QUESTIONS.map((q) => [q.id, ''])),
  emailConsent: false,
  smsConsent: false
})

function Companion() {
  return (
    <aside className="intake-companion" aria-label="Your care journey">
      <div className="intake-companion__intro">
        <span className="intake-kicker">
          <span />
          A little clarity. A fresh start.
        </span>
        <h1>
          Your wellbeing.
          <br />
          Your way.
        </h1>
        <p>A thoughtful first step toward a conversation with a licensed clinician.</p>
      </div>

      <div className="intake-scene">
        <div
          className="intake-video"
          role="img"
          aria-label="Illustrative image of a patient at home joining a video consultation on a laptop. Not an actual MmjGreen clinician or patient."
        >
          <img className="intake-scene__photo" src="/assets/telehealth-at-home.webp" alt="" />
          <span className="intake-video__caption">
            <IconVideo size={18} /> Video consultation
          </span>
        </div>

        <div className="intake-scene__badge">
          <IconShield size={18} />
          <span>
            Private by design
            <strong>Made for real people</strong>
          </span>
        </div>

        <div className="intake-card">
          <SampleCard eager />
        </div>
      </div>

      <div className="intake-companion__note">
        <IconClock size={18} />
        <p>
          <strong>A few minutes, at your pace.</strong>
          <span>No account or password needed. Save your answers when you&rsquo;re ready.</span>
        </p>
      </div>

      <p className="intake-companion__disclaimer">
        An evaluation is a conversation, not a guarantee of certification. Your clinician makes an
        independent decision.
      </p>
    </aside>
  )
}

function PreviewComplete() {
  return (
    <div className="care intake-experience intake-complete">
      <title>Preview complete | MmjGreen</title>
      <meta name="robots" content="noindex, nofollow, noarchive" />
      <main className="intake-complete__content" aria-label="Questionnaire completion">
        <div className="intake-complete__animation" role="status">
          <span className="sr-only">Questionnaire preview complete. Nothing was submitted.</span>
          <svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
            <circle className="intake-complete__circle" cx="60" cy="60" r="52" />
            <path className="intake-complete__check" d="M36 60L52 76L85 43" />
          </svg>
        </div>
        <Link to="/" className="btn btn--primary intake-complete__home">
          Go back to site <IconArrow size={18} />
        </Link>
      </main>
    </div>
  )
}

export default function PatientIntakePreview() {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState(emptyForm)
  const [done, setDone] = useState(false)

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))
  const setAnswer = (key, value) =>
    setForm((prev) => ({ ...prev, answers: { ...prev.answers, [key]: value } }))

  const [title, heading, note] = STEPS[step]
  const isLast = step === STEPS.length - 1

  const stepValid = useMemo(() => {
    if (step === 0) return Boolean(form.firstName && form.lastName && form.email && form.phone)
    if (step === 1) return Boolean(form.state && form.mode)
    if (step === 2) return QUESTIONS.every((q) => String(form.answers[q.id] ?? '').trim())
    if (step === 3) return Boolean(form.ageVerified)
    return true
  }, [step, form])

  if (done) return <PreviewComplete />

  return (
    <div className="care__stack">
      {/* Mirrors CareNotice, inlined because Workspace.jsx imports this module. */}
      <div className="notice notice--info" role="status">
        <strong>Frontend preview</strong>
        <p>
          Explore the questionnaire with sample details. No account, API connection, or real submission.
          Answers clear when you refresh.
        </p>
      </div>

      <div className="intake-layout">
        <Companion />

        <section className="intake-questionnaire" aria-labelledby="intake-step-title">
          <div className="intake-progress">
            <p className="intake-progress__caption">
              <span>YOUR PERSONAL INTAKE</span>
              <span>
                Step {step + 1} of {STEPS.length}
              </span>
            </p>
            <div
              className="intake-progress__track"
              role="progressbar"
              aria-label="Questionnaire progress"
              aria-valuemin={0}
              aria-valuemax={STEPS.length}
              aria-valuenow={step + 1}
            >
              {STEPS.map(([name], i) => (
                <span key={name} className={i <= step ? 'is-complete' : ''} />
              ))}
            </div>
            <ol className="intake-progress__steps">
              {STEPS.map(([name], i) => (
                <li key={name} aria-current={i === step ? 'step' : undefined}>
                  <span>{i < step ? <IconCheck size={12} /> : i + 1}</span>
                  {name}
                </li>
              ))}
            </ol>
          </div>

          <div className="intake-step-head">
            <span className="intake-kicker">
              {title} <span className="intake-step-head__count">/ 0{step + 1}</span>
            </span>
            <h2 id="intake-step-title" tabIndex={-1}>
              {heading}
            </h2>
            <p>{note}</p>
          </div>

          <div className="care__status">
            <div>
              <span className="tag tag--sage">Draft</span>
              <p className="care__status-note">Complete each step, then send it to your care team.</p>
            </div>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (isLast) setDone(true)
              else setStep((s) => s + 1)
            }}
          >
            {step === 0 ? (
              <fieldset className="care__group">
                <legend className="sr-only">About you</legend>
                <p className="float-card__meta">Complete each step, then send it to your care team.</p>
                <div className="care__row">
                  <label className="field">
                    <span className="field__label">First name</span>
                    <input className="field__control" autoComplete="given-name" maxLength={100} value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
                  </label>
                  <label className="field">
                    <span className="field__label">Last name</span>
                    <input className="field__control" autoComplete="family-name" maxLength={100} value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
                  </label>
                </div>
                <div className="care__row">
                  <label className="field">
                    <span className="field__label">Email</span>
                    <input className="field__control" type="email" autoComplete="email" maxLength={254} value={form.email} onChange={(e) => set('email', e.target.value)} />
                  </label>
                  <label className="field">
                    <span className="field__label">Phone number</span>
                    <input className="field__control" type="tel" autoComplete="tel" placeholder="303 555 0142" maxLength={50} value={form.phone} onChange={(e) => set('phone', e.target.value)} />
                  </label>
                </div>
              </fieldset>
            ) : null}

            {step === 1 ? (
              <fieldset className="care__group">
                <legend className="sr-only">Your visit</legend>
                <label className="field">
                  <span className="field__label">State or territory</span>
                  <select className="field__control" value={form.state} onChange={(e) => set('state', e.target.value)}>
                    <option value="">Select your state…</option>
                    {JURISDICTIONS.map((j) => (
                      <option key={j.code} value={j.code}>{j.name}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">How would you like to meet?</span>
                  <div className="care__choices">
                    {MODES.map((mode) => (
                      <label key={mode.value} className={`choice${form.mode === mode.value ? ' is-selected' : ''}`}>
                        <input type="radio" name="mode" checked={form.mode === mode.value} onChange={() => set('mode', mode.value)} />
                        <span className="choice__title">{mode.label}</span>
                        <span className="choice__note">{mode.note}</span>
                      </label>
                    ))}
                  </div>
                </label>
              </fieldset>
            ) : null}

            {step === 2 ? (
              <fieldset className="care__group">
                <legend className="sr-only">Your health</legend>
                {QUESTIONS.map((question, index) => (
                  <div className="intake-q" key={question.id}>
                    <span className="field__label">
                      {String(index + 1).padStart(2, '0')} · {question.label}
                    </span>
                    <textarea
                      className="field__control field__control--area"
                      rows={3}
                      value={form.answers[question.id] ?? ''}
                      onChange={(e) => setAnswer(question.id, e.target.value)}
                    />
                    <div className="intake-q__chips">
                      {(SUGGESTIONS[question.id] ?? []).map((suggestion) => (
                        <button key={suggestion} type="button" className="intake-chip" onClick={() => setAnswer(question.id, suggestion)}>
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </fieldset>
            ) : null}

            {step === 3 ? (
              <fieldset className="care__group">
                <legend className="sr-only">Your identity</legend>
                <div className="care__verify">
                  <span className="field__label">Age confirmation</span>
                  <div className="care__choices">
                    {['Yes', 'No'].map((option) => (
                      <label key={option} className={`choice choice--inline${form.ageVerified === option ? ' is-selected' : ''}`}>
                        <input type="radio" name="age" checked={form.ageVerified === option} onChange={() => set('ageVerified', option)} />
                        <span className="choice__title">{option}</span>
                      </label>
                    ))}
                  </div>
                  <p className="float-card__meta">
                    You must be 21 or older to hold a medical card in the states we serve. Answer honestly —
                    if you are not, we will point you to the right process instead of wasting your time.
                  </p>
                </div>

                <div className="care__verify">
                  <span className="field__label">Photo identification</span>
                  <p className="field__hint">
                    Optional in frontend preview. Photos stay in this browser and are not uploaded.
                  </p>
                  <div className="care__choices">
                    {ID_TYPES.map(([value, label]) => (
                      <label key={value} className={`choice choice--inline${form.idType === value ? ' is-selected' : ''}`}>
                        <input type="radio" name="id_type" checked={form.idType === value} onChange={() => set('idType', value)} />
                        <span className="choice__title">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </fieldset>
            ) : null}

            {step === 4 ? (
              <fieldset className="care__group">
                <legend className="sr-only">Review</legend>
                <div className="intake-review">
                  {[
                    ['First name', form.firstName || '—'],
                    ['Last name', form.lastName || '—'],
                    ['Email', form.email || '—'],
                    ['Phone', form.phone || '—'],
                    ['State', JURISDICTIONS.find((j) => j.code === form.state)?.name || '—'],
                    ['Consultation format', MODES.find((m) => m.value === form.mode)?.label || '—'],
                    ['Photo identification', ID_TYPES.find(([v]) => v === form.idType)?.[1] || 'Not provided']
                  ].map(([label, value]) => (
                    <div className="intake-review__row" key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </div>

                {QUESTIONS.map((question) => (
                  <div className="intake-review__answer" key={question.id}>
                    <span className="field__label">{question.label}</span>
                    <p>{form.answers[question.id]}</p>
                  </div>
                ))}

                <label className="check">
                  <input type="checkbox" checked={form.emailConsent} onChange={(e) => set('emailConsent', e.target.checked)} />
                  <span>
                    <strong>Email me about my care.</strong> Appointment confirmations, requests for missing
                    information, and application updates.
                  </span>
                </label>
                <label className="check">
                  <input type="checkbox" checked={form.smsConsent} onChange={(e) => set('smsConsent', e.target.checked)} />
                  <span>
                    <strong>Text me about my care.</strong> Reminders and short status updates. Message rates
                    may apply.
                  </span>
                </label>
              </fieldset>
            ) : null}

            <div className="care__actions intake-footer">
              <div className="intake-actions__secondary">
                {step > 0 ? (
                  <button type="button" className="btn btn--ghost" onClick={() => setStep((s) => s - 1)}>
                    Back
                  </button>
                ) : null}
                <button type="button" className="intake-save">
                  Keep for this preview
                </button>
              </div>
              <button type="submit" className="btn btn--primary" disabled={!isLast && !stepValid}>
                {isLast ? 'Finish preview' : 'Continue'}
                <IconArrow size={16} />
              </button>
            </div>

            <p className="care__fineprint">
              <IconShield size={14} /> Answers are encrypted at rest and are never sold or used for
              advertising. Read our <a href="/privacy-policy">privacy policy</a> and{' '}
              <a href="/telehealth-consent">telehealth consent</a>.
            </p>
          </form>
        </section>
      </div>
    </div>
  )
}