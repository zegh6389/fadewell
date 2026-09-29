/**
 * A fixed help launcher and its dialog.
 *
 * Uses a real `<dialog>` with `showModal()` so focus trapping, Escape and the
 * backdrop are handled by the platform rather than reimplemented. The launcher
 * button is kept mounted after the dialog closes so focus returns to it.
 */

import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { support } from '../lib/content.js'

const LINKS = [
  ['Start my intake', '/care'],
  ['Understand the process', '/service'],
  ['Prepare for my visit', '/patient-info'],
  ['Clinical standards', '/clinicians'],
  ['Billing or cancellation help', '/refund-policy']
]

export function PatientHelp() {
  const dialog = useRef(null)
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="help-launcher"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="patient-support"
        onClick={() => {
          dialog.current?.showModal()
          setOpen(true)
        }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z" />
          <path d="M7 10h9M7 14h5" />
        </svg>
        <span>Need help?</span>
      </button>

      <dialog
        ref={dialog}
        id="patient-support"
        className="help"
        aria-labelledby="help-title"
        onClose={() => setOpen(false)}
      >
        <header className="help__head">
          <h2 className="h4" id="help-title">
            Let’s find your next step.
          </h2>
          <button
            type="button"
            className="help__close"
            aria-label="Close help"
            onClick={() => dialog.current?.close()}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <nav className="help__links" aria-label="Help topics">
          {LINKS.map(([label, to]) => (
            <Link key={to} to={to} onClick={() => dialog.current?.close()}>
              {label}
            </Link>
          ))}
        </nav>

        <div className="help__direct">
          <strong>Talk to our team</strong>
          <a href={support.tel}>{support.phone}</a>
          <a href={support.mailto}>{support.email}</a>
          <p className="help__urgent">For a medical emergency, call your local emergency number.</p>
        </div>
      </dialog>
    </>
  )
}
