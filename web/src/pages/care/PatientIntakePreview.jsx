import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { IconArrow, IconCheck, IconClock, IconShield, IconVideo } from '../../components/Icons.jsx'
import { SampleCard } from '../../components/PremiumHero.jsx'

/**
 * Frontend-only intake preview.
 *
 * The full intake questionnaire with every network call removed. It exists so
 * the public deployment can show the real flow without implying it can accept
 * anything: there is no session, no save, and no submit. The banner says so in
 * those words and the completion screen repeats it for screen readers.
 *
 * Structure is a transcription of the production build, not a paraphrase. All
 * five fieldsets stay in the DOM and the inactive ones carry `hidden`, which
 * is how the original did it — so the cascade in `recovered.css` applies
 * unchanged. `.intake-card` is the tilted sample card in the companion column,
 * not a form container.
 */

const STEPS = [
  ['About you', 'Let’s start with you.', 'A few details so your care team can reach you.'],
  ['Your visit', 'Care that meets you where you are.', 'Choose your state and your preferred consultation format.'],
  ['Your health', 'Tell us your story.', 'Your answers help your clinician understand what matters to you.'],
  ['Your identity', 'A little peace of mind.', 'Confirm your age and add identification for your evaluation.'],
  ['Review', 'Your next chapter starts here.', 'Check your details and choose how we can keep you updated.']
]

/** Fieldset legends differ from the progress labels, exactly as production had them. */
const LEGENDS = ['About you', 'Where you are', 'Your evaluation', 'Your identity', 'Review and permissions']

const REASON_OPTIONS = ['First medical card evaluation', 'Renew my current certification']

const QUESTIONS = [
  { id: 'goals', label: 'What would you like to discuss with your clinician?', options: ['Discuss symptom management', 'Discuss a renewal', 'Understand benefits and risks'] },
  { id: 'history', label: 'What medical history should your clinician know about?', options: ['No medical history to report'] },
  { id: 'medications', label: 'Which medications or supplements do you currently take?', options: ['None'] },
  { id: 'allergies', label: 'Do you have any known allergies?', options: ['No known allergies'] }
]

const JURISDICTIONS = [
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'FL', name: 'Florida' },
  { code: 'NY', name: 'New York' }
]

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

const MAX_ANSWER = 4000

const emptyForm = () => ({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  state: '',
  mode: '',
  idType: '',
  ageVerified: '',
  reason: '',
  answers: Object.fromEntries(QUESTIONS.map((q) => [q.id, ''])),
  emailConsent: false,
  smsConsent: false
})

/** Mirrors the production normaliser: NANP becomes +1XXXXXXXXXX. */
function normalisePhone(raw) {
  const digits = String(raw ?? '').trim().replace(/[\s().-]/g, '')
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits
  const np = /^1([2-9]\d{2}[2-9]\d{6})$/.exec(digits)
  if (np) return `+1${np[1]}`
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits) ? `+1${digits}` : ''
}

function Companion() {
  return (
    <aside className="intake-companion" aria-label="Your care journey">
      <div className="intake-companion__intro">
        <span className="intake-kicker">
          <span /> A little clarity. A fresh start.
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
          <SampleCard />
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

/**
 * One health question: suggested chips plus, unless `custom` is false, a
 * free-text escape hatch. The chip and the textarea share one answer — typing
 * over a chip clears it, which is why the chip reads as unchecked once you
 * write your own.
 *
 * The ids come from `useId` rather than a hand-rolled `intake-${name}` so that
 * two questions can never collide on a page, and so the label, the radiogroup
 * and the character counter all point at the same generated id.
 *
 * `required` lands on the textarea when there is one, because that is the
 * control a person can always fill in. Only a question with no free-text field
 * puts it on the chips instead.
 */
function Quiz({ name, label, options, value, onChange, index, hint, custom = true }) {
  const uid = useId()
  const heading = index === undefined ? label : `${String(index + 1).padStart(2, '0')} · ${label}`
  const chipMatches = options.some((option) => option === value)
  const text = chipMatches ? '' : value

  return (
    <div className="quiz">
      <p className="field__label" id={`${uid}-label`}>
        {heading}
      </p>
      <p className="field__hint" id={`${uid}-hint`}>
        {hint ?? 'Tap an answer if one of these fits, or write your own below. You can change it later.'}
      </p>
      <div className="quiz__options" role="radiogroup" aria-labelledby={`${uid}-label`}>
        {options.map((option) => (
          <label key={option} className="quiz__chip">
            <input
              required={!custom}
              type="radio"
              value={option}
              name={name}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            <span>{option}</span>
            <span className="quiz__mark" aria-hidden="true">
              ↗
            </span>
          </label>
        ))}
      </div>
      {custom ? (
        <div className="quiz__custom">
          <label className="sr-only" htmlFor={uid}>
            {heading} — in your own words
          </label>
          <textarea
            id={uid}
            name={name}
            className="field__control field__control--area"
            rows={3}
            maxLength={MAX_ANSWER}
            required
            aria-describedby={`${uid}-hint ${uid}-count`}
            placeholder="Add your answer, or anything you want your clinician to know…"
            value={text}
            onChange={(event) => onChange(event.target.value)}
          />
          <p className="field__hint" id={`${uid}-count`}>
            {text.length.toLocaleString('en-US')} / {MAX_ANSWER.toLocaleString('en-US')} characters
          </p>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The end of the preview.
 *
 * This replaces the whole care shell rather than rendering inside it, so the
 * page drops its skip link, header and step chrome entirely — the questionnaire
 * is over and there is nothing left to navigate. The shell's owner renders it,
 * which is why it is exported.
 */
export function PreviewComplete() {
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

export default function PatientIntakePreview({ onComplete }) {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState(emptyForm)
  const [kept, setKept] = useState(false)

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))
  const setAnswer = (key, value) =>
    setForm((prev) => ({ ...prev, answers: { ...prev.answers, [key]: value } }))

  const [title, heading, note] = STEPS[step]
  const isLast = step === STEPS.length - 1

  const healthAnswered = QUESTIONS.filter((q) => String(form.answers[q.id] ?? '').trim()).length

  const reviewRows = useMemo(
    () => [
      {
        label: 'Your details',
        value: `${form.firstName} ${form.lastName}`.trim() || ' ',
        meta: `${form.email} · ${normalisePhone(form.phone)}`,
        aria: 'Edit your details',
        step: 0
      },
      {
        label: 'Your visit',
        value: JURISDICTIONS.find((j) => j.code === form.state)?.name || 'No state selected',
        meta: MODES.find((m) => m.value === form.mode)?.label || 'No format selected',
        aria: 'Edit your visit',
        step: 1
      },
      {
        label: 'Your health',
        value: form.reason.trim() || 'No reason provided',
        meta: `${healthAnswered} health answers completed`,
        aria: 'Edit your health',
        step: 2
      },
      {
        label: 'Your identity',
        value:
          form.ageVerified === 'Yes'
            ? 'Age 21 or older confirmed'
            : 'Age requires clinician review',
        meta: 'ID photo required before submission.',
        aria: 'Edit your identity',
        step: 3
      }
    ],
    [form, healthAnswered]
  )

  return (
    <div className="care__stack">
      {/* Mirrors CareNotice, inlined because Workspace.jsx imports this module. */}
      <div className="notice notice--info" role="status">
        <strong>Frontend preview</strong>
        <div>
          Explore the questionnaire with sample details. No account, API connection, or real submission.
          Answers clear when you refresh.
        </div>
      </div>

      <div className="intake-layout">
        <Companion />

        {/* `intake-questionnaire` is load-bearing: it is the ancestor selector
            for the dark green primary button and the form field overrides. */}
        <div className="care__stack intake-questionnaire">
          <div className="intake-progress">
            <div className="intake-progress__caption">
              <span>YOUR PERSONAL INTAKE</span>
              <span>
                Step {step + 1} of {STEPS.length}
              </span>
            </div>
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
            <h2 tabIndex={-1}>
              {heading}
            </h2>
            <p>{note}</p>
          </div>

          <div className="care__status">
            <div>
              <span className="tag tag--sage">Draft</span>
              <p className="care__status-note">Complete each step, then send it to your care team.</p>
            </div>
            {/* Production shows this after a successful save. There is no
                service behind this preview, so it appears only when the person
                explicitly asks to keep their answers. */}
            {kept ? (
              <span className="care__saved" role="status">
                <IconCheck size={14} /> Kept in this preview
              </span>
            ) : null}
          </div>

          <form
            className="care__form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              // Only the step on screen is validated. Every step stays mounted,
              // so asking the whole form would always fail on the four hidden
              // ones and the preview could never move past step one.
              //
              // The check is per-control rather than on the fieldset itself:
              // Chromium's HTMLFieldSetElement.reportValidity() only considers
              // the fieldset's own members and returns true here even with four
              // empty required inputs, so it would let an empty step through.
              const group = event.currentTarget.querySelector(`fieldset[data-step="${step}"]`)
              const controls = group ? [...group.querySelectorAll('input, select, textarea')] : []
              const invalid = controls.find((control) => !control.checkValidity())
              if (invalid) {
                invalid.reportValidity()
                return
              }
              // The phone is stored the way it will be dialled, not the way it
              // was typed: leaving step one rewrites "303 555 0142" as
              // "+13035550142", which is what production does on save.
              if (step === 0 && form.phone) set('phone', normalisePhone(form.phone))
              if (isLast) onComplete?.()
              else setStep((s) => s + 1)
            }}
          >
            <fieldset className="care__group" data-step="0" hidden={step !== 0}>
              <legend className="care__legend">
                <span className="care__legend-num">01</span> {LEGENDS[0]}
              </legend>

              <div className="care__row">
                <label className="field">
                  <span className="field__label">First name</span>
                  <input
                    className="field__control"
                    autoComplete="given-name"
                    maxLength={100}
                    required
                    value={form.firstName}
                    onChange={(e) => set('firstName', e.target.value)}
                    name="firstName"
                  />
                </label>
                <label className="field">
                  <span className="field__label">Last name</span>
                  <input
                    className="field__control"
                    autoComplete="family-name"
                    maxLength={100}
                    required
                    value={form.lastName}
                    onChange={(e) => set('lastName', e.target.value)}
                    name="lastName"
                  />
                </label>
              </div>

              <div className="care__row">
                <label className="field">
                  <span className="field__label">Email</span>
                  <input
                    className="field__control"
                    autoComplete="email"
                    maxLength={254}
                    required
                    type="email"
                    value={form.email}
                    onChange={(e) => set('email', e.target.value)}
                    name="email"
                  />
                </label>
                <label className="field">
                  <span className="field__label">Phone number</span>
                  <input
                    className="field__control"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="303 555 0142"
                    pattern="\+?[0-9][0-9\s().\-]{6,24}"
                    title="Digits, spaces and dashes. Add a country code if you are outside the US or Canada."
                    maxLength={50}
                    required
                    type="tel"
                    value={form.phone}
                    onChange={(e) => set('phone', e.target.value)}
                    name="phone"
                  />
                </label>
              </div>
            </fieldset>

            <fieldset className="care__group" data-step="1" hidden={step !== 1}>
              <legend className="care__legend">
                <span className="care__legend-num">02</span> {LEGENDS[1]}
              </legend>

              <label className="field">
                <span className="field__label">State or territory</span>
                <select
                  className="field__control"
                  name="state"
                  required
                  value={form.state}
                  onChange={(e) => set('state', e.target.value)}
                >
                  <option value="">Select your state…</option>
                  {JURISDICTIONS.map((j) => (
                    <option key={j.code} value={j.code}>
                      {j.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field__label">How would you like to meet?</span>
                <div className="care__choices">
                  {MODES.map((mode) => (
                    <label key={mode.value} className={`choice${form.mode === mode.value ? ' is-selected' : ''}`}>
                      <input
                        required
                        type="radio"
                        value={mode.value}
                        name="mode"
                        checked={form.mode === mode.value}
                        onChange={() => set('mode', mode.value)}
                      />
                      <span className="choice__title">{mode.label}</span>
                      <span className="choice__note">{mode.note}</span>
                    </label>
                  ))}
                </div>
              </label>
            </fieldset>

            <fieldset className="care__group" data-step="2" hidden={step !== 2}>
              <legend className="care__legend">
                <span className="care__legend-num">03</span> {LEGENDS[2]}
              </legend>

              <Quiz name="reason" label="What brings you in?" options={REASON_OPTIONS} value={form.reason} onChange={(v) => set('reason', v)} />
              {QUESTIONS.map((question, i) => (
                <Quiz
                  key={question.id}
                  name={question.id}
                  index={i}
                  label={question.label}
                  options={question.options}
                  value={form.answers[question.id]}
                  onChange={(v) => setAnswer(question.id, v)}
                />
              ))}
            </fieldset>

            <fieldset className="care__group" data-step="3" hidden={step !== 3}>
              <legend className="care__legend">
                <span className="care__legend-num">04</span> {LEGENDS[3]}
              </legend>

              <div className="care__verify">
                <Quiz
                  name="age_verified"
                  label="Age confirmation"
                  hint="Choose one of the options below."
                  options={['Yes', 'No']}
                  custom={false}
                  value={form.ageVerified}
                  onChange={(v) => set('ageVerified', v)}
                />
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
                      <input
                        type="radio"
                        value={value}
                        name="id_type"
                        checked={form.idType === value}
                        onChange={() => set('idType', value)}
                      />
                      <span className="choice__title">{label}</span>
                    </label>
                  ))}
                </div>
                <div className="idc">
                  <div className="quiz__options">
                    <button type="button" className="quiz__chip" disabled>
                      <span>Upload photo</span>
                      <span className="quiz__mark" aria-hidden="true">
                        ↗
                      </span>
                    </button>
                    <button type="button" className="quiz__chip" disabled>
                      <span>Use camera</span>
                      <span className="quiz__mark" aria-hidden="true">
                        ↗
                      </span>
                    </button>
                  </div>
                  <input accept="image/jpeg,image/png" hidden aria-label="Upload a photo of your ID" type="file" />
                  <p className="field__hint">Choose your ID type first.</p>
                </div>
              </div>
            </fieldset>

            <fieldset className="care__group" data-step="4" hidden={step !== 4}>
              <legend className="care__legend">
                <span className="care__legend-num">05</span> {LEGENDS[4]}
              </legend>

              <div className="intake-review">
                {reviewRows.map((row) => (
                  <div className="intake-review__row" key={row.label}>
                    <div>
                      <span>{row.label}</span>
                      <strong>{row.value}</strong>
                      <p>{row.meta}</p>
                    </div>
                    <button type="button" aria-label={row.aria} onClick={() => setStep(row.step)}>
                      Edit{' '}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                        <path d="M5 12h13M12.5 5.5 19 12l-6.5 6.5" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>

              <p className="float-card__meta">
                These are separate from your consent to treatment. You can change your mind about either one
                at any time, and declining will not affect your care.
              </p>

              <label className="check">
                <input type="checkbox" name="emailConsent" checked={form.emailConsent} onChange={(e) => set('emailConsent', e.target.checked)} />
                <span>
                  <strong>Email me about my care.</strong> Appointment confirmations, requests for missing
                  information, and application updates.
                </span>
              </label>

              <label className="check">
                <input type="checkbox" name="smsConsent" checked={form.smsConsent} onChange={(e) => set('smsConsent', e.target.checked)} />
                <span>
                  <strong>Text me about my care.</strong> Reminders and short status updates. Message rates
                  may apply.
                </span>
              </label>
            </fieldset>

            <div className="care__actions">
              <div className="intake-actions__secondary">
                {step > 0 ? (
                  <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setStep((s) => s - 1)}
                >
                  Back
                </button>
                ) : null}
                <button
                  type="button"
                  className="intake-save"
                  onClick={() => setKept(true)}
                >
                  Keep for this preview
                </button>
              </div>
              <button type="submit" className="btn btn--primary">
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
        </div>
      </div>
    </div>
  )
}