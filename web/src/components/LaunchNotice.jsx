/**
 * A dismissible availability notice.
 *
 * Appears once per browsing session, and the dismissal is remembered for the
 * session only â€” a permanent dismissal would hide a genuine service change
 * from anyone who happened to dismiss it months ago. The 500ms delay avoids a
 * flash of content that pushes the hero down before the reader has looked at
 * it.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { comingSoon } from '../lib/content.js'

const STORAGE_KEY = 'mmjgreen-launch-notice'

export function LaunchNotice() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let dismissed = false
    try {
      dismissed = window.sessionStorage.getItem(STORAGE_KEY) === 'dismissed'
    } catch {
      // Private browsing or blocked storage: show the notice every time.
      dismissed = false
    }
    if (dismissed) return undefined
    const timer = window.setTimeout(() => setVisible(true), 500)
    return () => window.clearTimeout(timer)
  }, [])

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, 'dismissed')
    } catch {
      // Dismissal still works for this render when storage is unavailable.
    }
    setVisible(false)
  }

  if (!visible) return null

  return (
    <aside className="banner" aria-label="Service availability update">
      <div className="shell banner__inner">
        <p className="banner__text">
          <strong>Availability update.</strong> {comingSoon.join(' and ')} {comingSoon.length === 1 ? 'is' : 'are'}{' '}
          coming soon. Everything else is open now.
        </p>
        <div className="banner__actions">
          <Link className="text-link" to="/#states" onClick={dismiss}>
            See all states
          </Link>
          <Link className="text-link" to="/contact" onClick={dismiss}>
            Get updates
          </Link>
          <button type="button" className="banner__close" onClick={dismiss} aria-label="Dismiss availability update">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  )
}
