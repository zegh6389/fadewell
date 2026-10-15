import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useSession,
  useServiceStatus,
  getPending,
  getSession,
  login,
  startGuestIntake,
  submitMfa
} from '../../lib/session.js'
import { careAreas, brand } from '../../lib/content.js'
import PatientIntakePreview, { PreviewComplete } from './PatientIntakePreview.jsx'
import { BrandMark, IconArrow, IconCheck, IconShield } from '../../components/Icons.jsx'
/* ---------- Shared chrome ------------------------------------- */

export function CareShell({ area, session, onSignOut, children }) {
  const meta = careAreas.find((a) => a.key === area)
  // The patient surface is the only one styled by `.care.intake-experience`,
  // which is where `--intake-green` is declared. Without it the primary button
  // resolves to an undefined variable and renders with no background at all.
  const isIntake = area === 'patient'
  return (
    <div className={`care${isIntake ? ' intake-experience' : ''}`}>
      {/* React 19 hoists this into <head>. Paired with the service's
          X-Robots-Tag header so the surface stays unindexed even if the
          bundle is served without the API in front of it. */}
      <meta name="robots" content="noindex, nofollow, noarchive" />
      <title>{isIntake ? 'Patient intake | MmjGreen' : `${meta?.label ?? 'Care'} | MmjGreen`}</title>
      {isIntake ? <a className="skip-link" href="#care-content">Skip to questionnaire</a> : null}
      <header className="care__bar">
        <Link to="/" className="brand" aria-label={`${brand.name} home`}>
          <BrandMark className="brand__mark" size={26} />
          <span>{brand.name}</span>
        </Link>
        <div className="care__bar-mid">
          {isIntake ? null : (
            <span className="tag tag--forest">{meta?.label ?? 'Workspace'}</span>
          )}
          {session ? <span className="care__who">{session.role.toLowerCase()}</span> : null}
        </div>
        <div className="care__bar-actions">
          {isIntake ? null : (
            <Link to="/" className="btn btn--quiet btn--sm">
              Site
            </Link>
          )}
          {session ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={onSignOut}>
              Sign out
            </button>
          ) : null}
        </div>
      </header>
      <main id="care-content" className="care__main" tabIndex={-1}>
        {children}
      </main>
    </div>
  )
}

export function CareLoader({ label = 'Checking your session…' }) {
  return (
    <div className="care__state" role="status" aria-live="polite">
      <span className="care__spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  )
}

export function CareNotice({ tone = 'info', title, children, action }) {
  return (
    <div className={`notice notice--${tone}`} role="status">
      {title ? <strong>{title}</strong> : null}
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  )
}

export function Unavailable({ title = 'The care service is not available yet.', children }) {
  return (
    <div className="care__state care__state--blocked">
      <span className="journey__icon care__state-icon">
        <IconShield size={22} />
      </span>
      <h1 className="h3">{title}</h1>
      {children ? <p className="lede">{children}</p> : null}
      <Link to="/" className="btn btn--ghost">
        Back to the site
        <IconArrow size={15} />
      </Link>
    </div>
  )
}

/* ---------- Workforce sign-in --------------------------------- */

function SignIn({ area, onAuthenticated }) {
  const meta = careAreas.find((a) => a.key === area)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState('login')
  const [secret, setSecret] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  // Password must never be held in state longer than the request needs it.
  useEffect(() => () => setPassword(''), [])

  async function handleLogin(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(username, password)
      const pending = await getPending()
      if (pending.step === 'mfa') {
        setSecret(pending.secret ?? null)
        setStep('mfa')
      } else {
        onAuthenticated()
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleMfa(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await submitMfa(code)
      onAuthenticated()
    } catch (err) {
      setError(err.message)
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="care__gate">
      <div className="care__gate-inner">
        <p className="eyebrow eyebrow--accent">{meta?.label}</p>
        <h1 className="h2">{meta?.title?.replace('\n', ' ')}</h1>
        <p className="lede">{meta?.body}</p>

        {error ? <CareNotice tone="error">{error}</CareNotice> : null}

        {step === 'login' ? (
          <form className="form" onSubmit={handleLogin}>
            <label className="field">
              <span className="field__label">Username</span>
              <input
                className="field__control"
                name="username"
                autoComplete="username"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Password</span>
              <input
                className="field__control"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
              {busy ? 'Checking…' : 'Continue'}
            </button>
          </form>
        ) : (
          <form className="form" onSubmit={handleMfa}>
            {secret ? (
              <CareNotice tone="info" title="Set up your authenticator">
                Scan the code, then enter the six digits it shows to finish setting up this account.
              </CareNotice>
            ) : (
              <p className="float-card__meta">Enter the six-digit code from your authenticator app.</p>
            )}
            <label className="field">
              <span className="field__label">Authentication code</span>
              <input
                className="field__control field__control--code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              />
            </label>
            <button type="submit" className="btn btn--primary btn--block" disabled={busy || code.length !== 6}>
              {busy ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              className="btn btn--quiet btn--block"
              onClick={() => {
                setStep('login')
                setCode('')
                setSecret(null)
                setError(null)
              }}
            >
              Use a different account
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

/* ---------- Patient entry ------------------------------------- */

function PatientEntry({ onStarted }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const meta = careAreas.find((a) => a.key === 'patient')

  async function handleStart() {
    setBusy(true)
    setError(null)
    try {
      await startGuestIntake()
      onStarted()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="care__gate">
      <div className="care__gate-inner">
        <p className="eyebrow eyebrow--accent">{meta?.label}</p>
        <h1 className="h2">
          {meta?.title?.split('\n')[0]}{' '}
          <span className="serif grad-text">{meta?.title?.split('\n')[1]}</span>
        </h1>
        <p className="lede">{meta?.body}</p>

        {error ? <CareNotice tone="error">{error}</CareNotice> : null}

        <ul className="care__points">
          {meta?.points.map(([title, body]) => (
            <li key={title}>
              <IconCheck size={16} />
              <span>
                <strong>{title}</strong>
                <span className="care__point-body">{body}</span>
              </span>
            </li>
          ))}
        </ul>

        <button type="button" className="btn btn--primary btn--block btn--lg" onClick={handleStart} disabled={busy}>
          {busy ? 'Opening your secure session…' : 'Start without an account'}
        </button>
        <p className="float-card__meta">
          <IconShield size={14} /> Your answers are encrypted and never shared for marketing.
        </p>
      </div>
    </div>
  )
}

/* ---------- Workspace shell ----------------------------------- */

/**
 * Standard wrapper for a care surface.
 *
 * `area` keys into careAreas; `role` is the session role required.
 * `Entry` renders the signed-out state, and `Surface` the signed-in one.
 */
export function Workspace({ area, role, isPatient = false, Surface }) {
  const { session, status, setSession, end } = useSession(role)
  const { info, state: serviceState } = useServiceStatus()
  const [intakeComplete, setIntakeComplete] = useState(false)

  if (status === 'loading') return <CareLoader />
  if (serviceState === 'unavailable') {
    // The public deployment has no care API behind it. Rather than dead-ending
    // the most likely entry point on an error, patient intake falls back to the
    // questionnaire with every network call removed. It accepts nothing, says
    // so on screen, and is never shown once a real service is reachable.
    if (isPatient) {
      // Once the questionnaire is finished it takes over the whole surface —
      // the shell's skip link, header and step chrome have no purpose left.
      if (intakeComplete) return <PreviewComplete />
      return (
        <CareShell area={area} session={session} onSignOut={end}>
          <PatientIntakePreview onComplete={() => setIntakeComplete(true)} />
        </CareShell>
      )
    }

    return (
      <CareShell area={area} session={session} onSignOut={end}>
        <Unavailable>
          The care service is not reachable right now. Your information is safe — please try again in a
          few minutes or call {brand.phone}.
        </Unavailable>
      </CareShell>
    )
  }

  // A workforce workspace cannot operate until the service is configured.
  if (!isPatient && !info?.configured) {
    return (
      <CareShell area={area} session={session} onSignOut={end}>
        <Unavailable title="This workspace is not configured yet.">
          An administrator needs to complete setup before {role.toLowerCase()} accounts can be used.
        </Unavailable>
      </CareShell>
    )
  }

  // Patient intake is gated on the service-side INTAKE_ENABLED flag.
  if (isPatient && info && !info.intakeEnabled) {
    return (
      <CareShell area={area} session={session} onSignOut={end}>
        <Unavailable title="Intake is not open yet.">
          New patient intake has not been enabled on this environment. Please check back shortly.
        </Unavailable>
      </CareShell>
    )
  }

  if (!session) {
    return (
      <CareShell area={area} session={null} onSignOut={end}>
        {isPatient ? (
          <PatientEntry onStarted={() => setSession({ role: 'PATIENT', pending: true })} />
        ) : (
          <SignIn
            area={area}
            onAuthenticated={async () => {
              setSession(await getSession())
            }}
          />
        )}
      </CareShell>
    )
  }

  if (isPatient && session.pending) {
    // Re-read the real session now the guest cookie exists.
    return <PatientSessionRefresh onReady={(s) => setSession(s)} />
  }

  return (
    <CareShell area={area} session={session} onSignOut={end}>
      <Surface session={session} />
    </CareShell>
  )
}

function PatientSessionRefresh({ onReady }) {
  const { session, status } = useSession('PATIENT')
  useEffect(() => {
    if (status === 'ready' && session) onReady(session)
  }, [status, session, onReady])
  return <CareLoader label="Opening your secure intake…" />
}
