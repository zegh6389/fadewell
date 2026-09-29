/**
 * A short-answer control for the intake questionnaire.
 *
 * Each question is one real control set: a radio group of the common answers,
 * plus a free-text box that is available from the start.
 *
 * The text box used to be hidden behind an "Other" chip. That was a mistake for
 * this form specifically: the free-text answers here are the clinically useful
 * part — a medical history, a medication list, what the patient actually wants
 * from the visit — and making a patient tap a chip before they are allowed to
 * type them trades a real cost for a small gain. The chips stay as one-tap
 * shortcuts that fill the same field.
 *
 * `allowOther={false}` is not a cosmetic flag. The age gate uses it so a
 * patient cannot satisfy a yes/no check by typing arbitrary text into a
 * free-text box, so the age question is a closed radio pair with no box.
 */

import { useId, useRef } from 'react'

/** Default answers per question name. Callers can override with `options`. */
const SUGGESTIONS = {
  reason: ['First medical card evaluation', 'Renew my current certification'],
  goals: ['Discuss symptom management', 'Discuss a renewal', 'Understand benefits and risks'],
  history: ['No medical history to report'],
  medications: ['None'],
  allergies: ['No known allergies']
}

const MAX = 4000

export function QuizAnswer({ name, label, value, onChange, options, allowOther = true, disabled = false }) {
  const id = useId()
  const box = useRef(null)
  const optionsForName = options ?? SUGGESTIONS[name] ?? []
  const length = (value || '').length

  return (
    <div className="quiz">
      <p className="field__label" id={`${id}-label`}>
        {label}
      </p>
      <p className="field__hint" id={`${id}-hint`}>
        {allowOther
          ? 'Tap an answer if one of these fits, or write your own below. You can change it later.'
          : 'Choose one of the options below.'}
      </p>

      <div className="quiz__options" role="radiogroup" aria-labelledby={`${id}-label`}>
        {optionsForName.map((option) => (
          <label className="quiz__chip" key={option}>
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              disabled={disabled}
              onChange={() => onChange(option)}
            />
            <span>{option}</span>
            <span className="quiz__mark" aria-hidden="true">
              {value === option ? '✓' : '↗'}
            </span>
          </label>
        ))}
      </div>

      {allowOther && (
        <div className="quiz__custom">
          <label className="sr-only" htmlFor={id}>
            {label} — in your own words
          </label>
          <textarea
            ref={box}
            id={id}
            name={name}
            className="field__control field__control--area"
            rows={3}
            maxLength={MAX}
            value={value || ''}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            aria-describedby={`${id}-hint ${id}-count`}
            placeholder="Add your answer, or anything you want your clinician to know…"
          />
          <p className="field__hint" id={`${id}-count`}>
            {length.toLocaleString('en-US')} / {MAX.toLocaleString('en-US')} characters
          </p>
        </div>
      )}
    </div>
  )
}
