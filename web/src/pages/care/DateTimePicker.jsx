/**
 * Appointment date and time.
 *
 * A calendar grid with a handful of time shortcuts, layered over a real
 * `datetime-local` input. The native input is the source of truth: it is what
 * a phone user gets when they tap it, it is keyboard accessible for free, and
 * it round-trips through a form without any JavaScript. The grid above it is
 * a convenience, not a replacement.
 *
 * Past days and past times are disabled, so the control cannot produce a
 * booking for a moment that has already passed.
 */

import { useId, useState } from 'react'

const pad = (value) => String(value).padStart(2, '0')
const localDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const PRESETS = ['09:00', '12:00', '15:00', '17:00']

export function DateTimePicker({ name, label, onChange }) {
  const id = useId()
  const [value, setValue] = useState('')
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })

  const now = new Date()
  const today = localDate(now)
  const nowTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  const selected = value.split('T')[0]
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()

  const update = (next) => {
    setValue(next)
    onChange?.(next)
  }

  const chooseDay = (date) => {
    const time = value.split('T')[1] || (date === today ? nowTime : '09:00')
    update(`${date}T${time}`)
  }

  const chooseTime = (time) => {
    // Picking a time with no day chosen defaults to today if it is still in the
    // future, otherwise tomorrow — never a slot that has already gone.
    const day = selected || (time > nowTime ? today : localDate(new Date(now.getTime() + 86400000)))
    update(`${day}T${time}`)
  }

  return (
    <div className="dtp">
      <p className="dtp__heading">
        <strong>{label}</strong>
        <span className="field__hint">Your local time</span>
      </p>

      <div className="dtp__month">
        <button
          type="button"
          className="dtp__arrow"
          aria-label={`Previous month for ${label}`}
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
        >
          <span aria-hidden="true">←</span>
        </button>
        <span className="dtp__month-name" aria-live="polite">
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        <button
          type="button"
          className="dtp__arrow"
          aria-label={`Next month for ${label}`}
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
        >
          <span aria-hidden="true">→</span>
        </button>
      </div>

      <div className="dtp__grid" role="group" aria-label={`Choose a date for ${label}`}>
        {WEEKDAYS.map((day) => (
          <span className="dtp__weekday" key={day}>
            {day}
          </span>
        ))}
        {Array.from({ length: month.getDay() }, (_, index) => (
          <span key={`empty-${index}`} />
        ))}
        {Array.from({ length: days }, (_, index) => {
          const date = new Date(month.getFullYear(), month.getMonth(), index + 1)
          const dateValue = localDate(date)
          return (
            <button
              type="button"
              className="dtp__day"
              key={dateValue}
              disabled={dateValue < today}
              aria-label={`${date.toLocaleDateString(undefined, { dateStyle: 'full' })}, ${label}`}
              aria-pressed={selected === dateValue}
              aria-current={dateValue === today ? 'date' : undefined}
              onClick={() => chooseDay(dateValue)}
            >
              {index + 1}
            </button>
          )
        })}
      </div>

      <div className="dtp__presets" role="group" aria-label={`Suggested times for ${label}`}>
        {PRESETS.map((time) => (
          <button
            type="button"
            className="dtp__preset"
            key={time}
            disabled={selected === today && time <= nowTime}
            aria-pressed={Boolean(selected) && value.endsWith(`T${time}`)}
            onClick={() => chooseTime(time)}
          >
            {time}
          </button>
        ))}
      </div>

      <div className="field">
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
        <input
          className="field__control"
          id={id}
          type="datetime-local"
          name={name}
          required
          value={value}
          min={`${today}T00:00`}
          onChange={(event) => {
            update(event.target.value)
            if (!event.target.value) return
            const date = new Date(event.target.value)
            setMonth(new Date(date.getFullYear(), date.getMonth(), 1))
          }}
        />
        <p className="field__hint">
          Pick any exact date and time here. The shortcuts above are suggestions, not confirmed slots.
        </p>
      </div>
    </div>
  )
}
