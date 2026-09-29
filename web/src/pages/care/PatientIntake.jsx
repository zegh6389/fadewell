import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Workspace, CareNotice, CareLoader } from './Workspace.jsx'
import {
  getIntake,
  getJurisdictions,
  getQuestionnaire,
  saveIntake,
  submitIntake,
  getWorkspace
} from '../../lib/api.js'
import { IconArrow, IconCheck, IconClock, IconShield } from '../../components/Icons.jsx'

const MODES = [
  { value: 'VIDEO', label: 'Video call', note: 'Face to face, from wherever you are' },
  { value: 'PHONE', label: 'Phone call', note: 'A clinician calls you' },
  { value: 'EITHER', label: 'Either is fine', note: 'Pick whatever is available first' }
]

const STATE_COPY = {
  DRAFT: { label: 'Draft', tone: 'info', note: 'Your answers are saved. Submit when you are ready.' },
  SUBMITTED: { label: 'Submitted', tone: 'ok', note: 'Your care team is reviewing your intake.' },
  NEEDS_REVIEW: {
    label: 'Needs your attention',
    tone: 'warn',
    note: 'Something is missing or unclear. Open the details below.'
  },
  REVIEWED: { label: 'Reviewed', tone: 'ok', note: 'Reviewed. A clinician will be assigned to you.' },
  SCHEDULED: { label: 'Booked', tone: 'ok', note: 'Your consultation is booked.' },
  COMPLETED: { label: 'Complete', tone: 'ok', note: 'Your evaluation is complete.' },
  CANCELLED: { label: 'Cancelled', tone: 'warn', note: 'This intake was cancelled.' }
}

const ISSUE_LABELS = {
  NAME_REQUIRED: 'We need your first and last name.',
  EMAIL_REQUIRES_REVIEW: 'Check your email address — it did not look complete.',
  PHONE_REQUIRES_REVIEW: 'Check your phone number. We need a full number with country code.',
  REASON_REQUIRED: 'Tell us briefly what brings you in.',
  AGE_VERIFICATION_REQUIRED: 'Confirm you are 21 or older.',
  AGE_REQUIRES_REVIEW: 'We could not confirm you are 21 or older. A clinician will follow up.',
  ANSWER_GOALS_REQUIRED: 'The goals question still needs an answer.',
  ANSWER_HISTORY_REQUIRED: 'The medical history question still needs an answer.',
  ANSWER_MEDICATIONS_REQUIRED: 'The medications question still needs an answer.',
  ANSWER_ALLERGIES_REQUIRED: 'The allergies question still needs an answer.'
}

function blankAnswers(questions) {
  return Object.fromEntries(questions.map((q) => [q.id, '']))
}

/* ---------- Intake form --------------------------------------- */

function IntakeForm({ session, questionnaire, jurisdictions, existing, onSaved, onSubmitted }) {
  const data = existing?.data ?? {}
  const isLocked = existing?.state === 'SUBMITTED' || existing?.state === 'REVIEWED' ||
    existing?.state === 'SCHEDULED' || existing?.state === 'COMPLETED'

  const [form, setForm] = useState(() => ({
    firstName: data.firstName ?? '',
    lastName: data.lastName ?? '',
    email: data.email ?? '',
    phone: data.phone ?? '',
    state: data.state ?? '',
    reason: data.reason ?? '',
    mode: data.mode ?? '',
    smsConsent: data.smsConsent ?? false,
    emailConsent: data.emailConsent ?? false,
    answers: { ...blankAnswers(questionnaire.questions), ...(data.answers ?? {}) }
  }))
  const [version, setVersion] = useState(existing?.version ?? 0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [summary, setSummary] = useState(null)
  const firstError = useRef(null)

  const set = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }
  const setAnswer = (key, value) => {
    setForm((prev) => ({ ...prev, answers: { ...prev.answers, [key]: value } }))
    setSaved(false)
  }

  const activeStates = useMemo(
    () => jurisdictions.filter((j) => !j.comingSoon),
    [jurisdictions]
  )

  const jurisdiction = useMemo(
    () => jurisdictions.find((j) => j.code === form.state) ?? null,
    [jurisdictions, form.state]
  )

  // Visit-mode rules come from the jurisdiction record, not a hard-coded list.
  const allowedModes = useMemo(() => {
    const types = jurisdiction?.visitTypes ?? []
    if (!types.length) return MODES
    const allowed = MODES.filter((m) => {
      if (m.value === 'VIDEO') return types.includes('VIDEO')
      if (m.value === 'PHONE') return types.includes('PHONE')
      return types.includes('VIDEO') || types.includes('PHONE')
    })
    return allowed.length ? allowed : MODES
  }, [jurisdiction])

  const buildPayload = useCallback(
    () => ({
      version,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      state: form.state,
      reason: form.reason.trim(),
      mode: form.mode,
      smsConsent: form.smsConsent,
      emailConsent: form.emailConsent,
      answers: Object.fromEntries(
        Object.entries(form.answers)
          .filter(([key, value]) => key !== 'age_verified' && String(value ?? '').trim())
          .map(([key, value]) => [key, String(value).trim()])
      )
    }),
    [form, version]
  )

  async function handleSave(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const result = await saveIntake(buildPayload(), session.csrf)
      setVersion(result.intake?.version ?? version)
      setSaved(true)
      onSaved?.(result.intake)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSubmit() {
    setSaving(true)
    setError(null)
    try {
      // Persist the current edits first so submit never acts on stale data.
      const savedResult = await saveIntake(buildPayload(), session.csrf)
      const nextVersion = savedResult.intake?.version ?? version
      setVersion(nextVersion)
      const result = await submitIntake(
        { version: nextVersion, requestKey: crypto.randomUUID() },
        session.csrf
      )
      setSummary(result)
      onSubmitted?.(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const state = STATE_COPY[existing?.state] ?? STATE_COPY.DRAFT

  return (
    <div className="care__stack">
      <div className="care__status">
        <div>
          <span className={`tag tag--${state.tone === 'ok' ? 'lime' : state.tone === 'warn' ? 'amber' : 'sage'}`}>
            {state.label}
          </span>
          <p className="care__status-note">{state.note}</p>
        </div>
        {saved ? (
          <span className="care__saved" role="status">
            <IconCheck size={14} /> Saved
          </span>
        ) : null}
      </div>

      {error ? <CareNotice tone="error">{error}</CareNotice> : null}

      {existing?.issues?.length ? (
        <CareNotice tone="warn" title="We need a little more from you">
          <ul className="care__issues">
            {existing.issues.map((issue) => (
              <li key={issue}>{ISSUE_LABELS[issue] ?? issue.replace(/_/g, ' ').toLowerCase()}</li>
            ))}
          </ul>
        </CareNotice>
      ) : null}

      <form className="care__form" onSubmit={handleSave}>
        <fieldset className="care__group" disabled={isLocked}>
          <legend className="care__legend">
            <span className="care__legend-num">01</span> About you
          </legend>

          <div className="care__row">
            <label className="field">
              <span className="field__label">First name</span>
              <input
                className="field__control"
                name="firstName"
                autoComplete="given-name"
                maxLength={100}
                required
                value={form.firstName}
                onChange={(event) => set('firstName', event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Last name</span>
              <input
                className="field__control"
                name="lastName"
                autoComplete="family-name"
                maxLength={100}
                required
                value={form.lastName}
                onChange={(event) => set('lastName', event.target.value)}
              />
            </label>
          </div>

          <div className="care__row">
            <label className="field">
              <span className="field__label">Email</span>
              <input
                className="field__control"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
                value={form.email}
                onChange={(event) => set('email', event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Phone (with country code)</span>
              <input
                className="field__control"
                name="phone"
                type="tel"
                autoComplete="tel"
                placeholder="+13035550142"
                maxLength={50}
                required
                value={form.phone}
                onChange={(event) => set('phone', event.target.value)}
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="care__group" disabled={isLocked}>
          <legend className="care__legend">
            <span className="care__legend-num">02</span> Where you are
          </legend>

          <label className="field">
            <span className="field__label">State or territory</span>
            <select
              className="field__control"
              name="state"
              required
              value={form.state}
              onChange={(event) => set('state', event.target.value)}
            >
              <option value="">Select your state…</option>
              {jurisdictions.map((j) => (
                <option key={j.code} value={j.code} disabled={j.comingSoon}>
                  {j.name}
                  {j.comingSoon ? ' — waitlist only' : ''}
                </option>
              ))}
            </select>
          </label>

          {jurisdiction ? (
            <CareNotice tone="ok">
              {jurisdiction.name} is {jurisdiction.comingSoon ? 'on the waitlist' : 'open for evaluations'}.
              {Array.isArray(jurisdiction.visitTypes) && jurisdiction.visitTypes.length
                ? ` Consultations are available ${jurisdiction.visitTypes.map((t) => t.toLowerCase()).join(' or ')}.`
                : ''}
            </CareNotice>
          ) : null}

          {form.state && activeStates.length && !activeStates.some((j) => j.code === form.state) ? (
            <CareNotice tone="warn">
              We are not accepting new patients in that state yet. Submit anyway and we will add you to
              the waitlist.
            </CareNotice>
          ) : null}

          <label className="field">
            <span className="field__label">How would you like to meet?</span>
            <div className="care__choices">
              {allowedModes.map((mode) => (
                <label
                  key={mode.value}
                  className={`choice${form.mode === mode.value ? ' is-selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="mode"
                    value={mode.value}
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

        <fieldset className="care__group" disabled={isLocked}>
          <legend className="care__legend">
            <span className="care__legend-num">03</span> Your evaluation
          </legend>

          <label className="field">
            <span className="field__label">What brings you in?</span>
            <textarea
              className="field__control field__control--area"
              name="reason"
              rows={4}
              maxLength={4000}
              required
              placeholder="A short description helps your clinician prepare before you meet."
              value={form.reason}
              onChange={(event) => set('reason', event.target.value)}
            />
          </label>

          {questionnaire.questions.map((question, index) => (
            <label className="field" key={question.id}>
              <span className="field__label">
                {String(index + 1).padStart(2, '0')} · {question.label}
              </span>
              <textarea
                className="field__control field__control--area"
                name={question.id}
                rows={3}
                maxLength={4000}
                required={question.required}
                value={form.answers[question.id] ?? ''}
                onChange={(event) => setAnswer(question.id, event.target.value)}
              />
            </label>
          ))}

          <div className="care__verify">
            <span className="field__label">Age confirmation</span>
            <div className="care__choices">
              {['Yes', 'No'].map((option) => (
                <label key={option} className={`choice choice--inline${form.answers.age_verified === option ? ' is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="age_verified"
                    value={option}
                    checked={form.answers.age_verified === option}
                    onChange={() => setAnswer('age_verified', option)}
                  />
                  <span className="choice__title">
                    {option === 'Yes' ? 'Yes, I am 21 or older' : 'No, I am under 21'}
                  </span>
                </label>
              ))}
            </div>
            <p className="float-card__meta">
              You must be 21 or older to hold a medical card in the states we serve. Answer honestly —
              if you are not, we will point you to the right process instead of wasting your time.
            </p>
          </div>
        </fieldset>

        <fieldset className="care__group" disabled={isLocked}>
          <legend className="care__legend">
            <span className="care__legend-num">04</span> Permissions
          </legend>

          <p className="float-card__meta">
            These are separate from your consent to treatment. You can change your mind about either one
            at any time, and declining will not affect your care.
          </p>

          <label className="check">
            <input
              type="checkbox"
              name="emailConsent"
              checked={form.emailConsent}
              onChange={(event) => set('emailConsent', event.target.checked)}
            />
            <span>
              <strong>Email me about my care.</strong> Appointment confirmations, requests for missing
              information, and application updates.
            </span>
          </label>

          <label className="check">
            <input
              type="checkbox"
              name="smsConsent"
              checked={form.smsConsent}
              onChange={(event) => set('smsConsent', event.target.checked)}
            />
            <span>
              <strong>Text me about my care.</strong> Reminders and short status updates. Message rates
              may apply.
            </span>
          </label>
        </fieldset>

        <div className="care__actions">
          <button type="submit" className="btn btn--ghost" disabled={saving || isLocked}>
            {saving ? 'Saving…' : 'Save and finish later'}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={saving || isLocked}
            onClick={handleSubmit}
          >
            {saving ? 'Submitting…' : 'Submit for review'}
            <IconArrow size={16} />
          </button>
        </div>

        <p className="care__fineprint">
          <IconShield size={14} /> Answers are encrypted at rest and are never sold or used for
          advertising. Read our{' '}
          <a href="/privacy-policy">privacy policy</a> and{' '}
          <a href="/telehealth-consent">telehealth consent</a>.
        </p>
      </form>

      {summary ? <SubmittedSummary summary={summary} /> : null}
    </div>
  )
}

/* ---------- Post-submit summary ------------------------------- */

function SubmittedSummary({ summary }) {
  return (
    <CareNotice tone="ok" title="Your intake is with our care team">
      <p>{summary?.message ?? 'We have everything we need to start reviewing your intake.'}</p>
      <ul className="care__issues">
        {(summary?.issues ?? []).map((issue) => (
          <li key={issue}>{ISSUE_LABELS[issue] ?? issue.replace(/_/g, ' ').toLowerCase()}</li>
        ))}
      </ul>
      <p>
        <IconClock size={14} /> We usually review intakes within one business day. You will hear from us
        by the channels you selected.
      </p>
    </CareNotice>
  )
}

/* ---------- Patient surface ----------------------------------- */

function PatientSurface({ session }) {
  const [state, setState] = useState('loading')
  const [data, setData] = useState({ questionnaire: null, jurisdictions: [], intake: null })
  const [appointments, setAppointments] = useState([])

  const load = useCallback(async () => {
    try {
      const [questionnaire, jurisdictions, intake, workspace] = await Promise.all([
        getQuestionnaire(),
        getJurisdictions(),
        getIntake().catch(() => ({ intake: null })),
        getWorkspace().catch(() => ({ appointments: [] }))
      ])
      setData({
        questionnaire,
        jurisdictions: jurisdictions?.jurisdictions ?? [],
        intake: intake?.intake ?? null
      })
      setAppointments(workspace?.appointments ?? [])
      setState('ready')
    } catch {
      setState('error')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (state === 'loading') return <CareLoader label="Loading your intake…" />
  if (state === 'error') {
    return (
      <CareNotice tone="error" title="We could not load your intake">
        Refresh the page, or use the link in your confirmation message. If this keeps happening, call
        us and we will sort it out.
      </CareNotice>
    )
  }

  const upcoming = appointments
    .filter((a) => a.status === 'CONFIRMED' && new Date(a.starts_at) > new Date())
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))

  return (
    <div className="care__stack">
      <div className="care__head">
        <div>
          <p className="eyebrow eyebrow--accent">Patient intake</p>
          <h1 className="h2">Your care, in one place.</h1>
          <p className="lede">
            Everything here is saved as you go. You can stop at any point and come back with the secure
            link we sent you.
          </p>
        </div>
      </div>

      {upcoming.length ? (
        <section className="care__card">
          <h2 className="h4">Your next appointment</h2>
          <ul className="care__appointments">
            {upcoming.map((appointment) => (
              <li key={appointment.id}>
                <span className="care__appt-when">
                  {new Date(appointment.starts_at).toLocaleString(undefined, {
                    dateStyle: 'full',
                    timeStyle: 'short'
                  })}
                </span>
                <span className="tag tag--moss">{appointment.mode.replace('_', ' ')}</span>
              </li>
            ))}
          </ul>
          <p className="float-card__meta">
            Need to change it? Message your care team and we will find another slot.
          </p>
        </section>
      ) : null}

      {data.intake && ['SUBMITTED', 'REVIEWED', 'SCHEDULED', 'COMPLETED'].includes(data.intake.state) ? (
        <CareNotice tone="ok" title="Your intake has been submitted">
          You do not need to do anything else right now. We will contact you about the next step.
        </CareNotice>
      ) : null}

      <IntakeForm
        session={session}
        questionnaire={data.questionnaire ?? { questions: [] }}
        jurisdictions={data.jurisdictions}
        existing={data.intake}
        onSaved={(intake) => setData((prev) => ({ ...prev, intake }))}
        onSubmitted={() => load()}
      />
    </div>
  )
}

export default function PatientIntake() {
  return (
    <Workspace area="patient" role="PATIENT" isPatient Surface={PatientSurface} />
  )
}
