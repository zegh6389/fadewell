/**
 * "Where do you live?" — the eligibility check.
 *
 * The single most-used control on the site, and the one the reader is most
 * likely to abandon on, so the outcome is announced politely and the error
 * path returns focus to the field rather than silently doing nothing.
 *
 * `compact` drops the label and the button into a single row for use inside
 * the final CTA band.
 */

import { useId, useState } from 'react'
import { Link } from 'react-router-dom'

import { getStateOutcome, stateNames, comingSoon } from '../lib/content.js'

export function StateSelector({ compact = false }) {
  const fieldId = useId()
  const [selected, setSelected] = useState('')
  const [outcome, setOutcome] = useState(null)

  const submit = (event) => {
    event.preventDefault()
    const next = getStateOutcome(selected)
    setOutcome(next)
    if (next.kind === 'error') document.getElementById(fieldId)?.focus()
  }

  return (
    <form className={`state-picker${compact ? ' state-picker--compact' : ''}`} onSubmit={submit} noValidate>
      <label className="field__label" htmlFor={fieldId}>
        Where do you live?
      </label>

      <div className="state-picker__controls">
        <div className="select-wrap">
          <select
            id={fieldId}
            className="field__control"
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value)
              setOutcome(null)
            }}
            aria-invalid={outcome?.kind === 'error'}
            aria-describedby={`${fieldId}-status`}
          >
            <option value="">Select your state or territory</option>
            {stateNames.map((name) => (
              <option key={name} value={name}>
                {name}
                {comingSoon.includes(name) ? ' · Coming soon' : ''}
              </option>
            ))}
          </select>
          <span className="select-wrap__caret" aria-hidden="true" />
        </div>
        <button className="btn btn--primary" type="submit">
          Check my eligibility
        </button>
      </div>

      <p
        id={`${fieldId}-status`}
        className={`state-picker__status${outcome ? ` is-${outcome.kind}` : ''}`}
        aria-live="polite"
      >
        {outcome?.message}
        {outcome?.kind === 'available' && (
          <>
            {' '}
            <Link className="text-link" to={`/patient?state=${encodeURIComponent(selected)}`}>
              Continue to the intake
            </Link>
            . No account needed.
          </>
        )}
        {outcome?.kind === 'coming-soon' && (
          <>
            {' '}
            <Link className="text-link" to={`/contact?state=${encodeURIComponent(selected)}`}>
              Get launch updates
            </Link>
            .
          </>
        )}
      </p>

      <p className="state-picker__note">
        Eligibility is decided by a clinician, not this website.
      </p>
    </form>
  )
}
