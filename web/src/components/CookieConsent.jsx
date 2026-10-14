import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { IconShield } from '../components/Icons.jsx'

/**
 * Cookie consent.
 *
 * One preference, stored locally, with no category beyond "optional". There
 * are no tracking plugins connected, and the copy says so rather than implying
 * a choice that does not exist. The dialog can be reopened from the footer via
 * a window event, which is why the listener lives here rather than in a
 * context — the trigger is rendered by a component that has no access to this
 * state.
 */

const STORAGE_KEY = 'mmjgreen.cookie-consent'
const OPEN_EVENT = 'mmjgreen:cookie-settings'

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function openCookieSettings() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

export default function CookieConsent() {
  const [stored, setStored] = useState(read)
  const [optional, setOptional] = useState(stored?.optional ?? false)
  const [error, setError] = useState('')
  const dialogRef = useRef(null)

  useEffect(() => {
    const onOpen = () => {
      setOptional(read()?.optional ?? false)
      dialogRef.current?.showModal()
    }
    const onStorage = (event) => {
      if (event.key === STORAGE_KEY || event.key === null) setStored(read())
    }
    window.addEventListener(OPEN_EVENT, onOpen)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const save = useCallback((value) => {
    const record = { version: 1, optional: value, savedAt: Date.now() }
    setError('')
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
    } catch {
      setError(
        'Your browser could not save this preference. Your choice applies to this visit; you may be asked again after reloading.'
      )
    }
    setStored(record)
    setOptional(value)
    dialogRef.current?.close()
  }, [])

  return (
    <>
      {!stored ? (
        <section className="cookie-banner" role="region" aria-labelledby="cookie-banner-title">
          <div className="cookie-banner__heading">
            <span className="cookie-mark">
              <IconShield size={24} />
            </span>
            <div>
              <span className="cookie-kicker">A little clarity about cookies</span>
              <h2 id="cookie-banner-title">Your privacy. Your choice.</h2>
            </div>
          </div>
          <p>
            Essential cookies support secure sessions. You choose whether optional cookies may be used. No
            optional tracking plugins are connected at present.
          </p>
          <div className="cookie-actions">
            <button type="button" className="btn btn--forest" onClick={() => save(false)}>
              Essential cookies only
            </button>
            <button type="button" className="btn btn--forest" onClick={() => save(true)}>
              Allow optional cookies
            </button>
          </div>
          <div className="cookie-banner__links">
            <button type="button" className="cookie-settings-link" onClick={openCookieSettings}>
              Cookie settings
            </button>
            <Link to="/privacy-policy">Read our privacy policy ↗</Link>
          </div>
        </section>
      ) : null}

      <dialog
        ref={dialogRef}
        className="cookie-dialog"
        aria-labelledby="cookie-settings-title"
        aria-describedby="cookie-settings-description"
      >
        <div className="cookie-dialog__header">
          <span className="cookie-mark">
            <IconShield size={24} />
          </span>
          <button
            type="button"
            className="cookie-close"
            aria-label="Close cookie settings"
            onClick={() => dialogRef.current?.close()}
            autoFocus
          >
            ×
          </button>
        </div>

        <span className="cookie-kicker">MmjGreen · Privacy preferences</span>
        <h2 id="cookie-settings-title">Keep the choice yours.</h2>
        <p id="cookie-settings-description">
          Choose what this browser may remember. You can revisit these settings from the footer at any time.
        </p>

        <div className="cookie-category">
          <div>
            <h3>Essential cookies</h3>
            <p>Support secure sessions and core features. This preference is also stored on your device.</p>
          </div>
          <span className="cookie-always">Always active</span>
        </div>

        <label className="cookie-category cookie-category--optional">
          <span>
            <strong>Optional cookies</strong>
            <span>Nothing extra is connected today. This switch exists so the choice stays yours if that changes.</span>
          </span>
          <input
            type="checkbox"
            checked={optional}
            onChange={(event) => setOptional(event.target.checked)}
            aria-label="Allow optional cookies"
          />
        </label>

        {error ? <p className="cookie-dialog__note">{error}</p> : null}

        <div className="cookie-actions">
          <button type="button" className="btn btn--forest" onClick={() => save(optional)}>
            Save preferences
          </button>
        </div>

        <Link className="cookie-policy-link" to="/privacy-policy">
          Read the full privacy policy ↗
        </Link>
      </dialog>
    </>
  )
}