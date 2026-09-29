/**
 * Coverage table.
 *
 * Reads jurisdictions from the live API rather than a baked-in list, so the
 * table cannot drift from what intake will actually accept. The static list in
 * `content.js` is only used by the state picker, which has to work before any
 * request resolves.
 *
 * If the API is unreachable the panel renders a single honest sentence instead
 * of a table of stale data — a coverage table that is quietly out of date is
 * worse than no table.
 */

import { useEffect, useState } from 'react'

import { getJurisdictions } from '../lib/api.js'

export function StatesPanel() {
  const [rows, setRows] = useState([])
  const [state, setState] = useState('loading')

  useEffect(() => {
    let cancelled = false
    getJurisdictions({ timeout: 6000 })
      .then((data) => {
        if (cancelled) return
        const list = Array.isArray(data?.jurisdictions) ? data.jurisdictions : []
        setRows(list.slice().sort((a, b) => a.name.localeCompare(b.name)))
        setState(list.length ? 'ready' : 'empty')
      })
      .catch(() => {
        if (!cancelled) setState('failed')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const open = rows.filter((r) => !r.comingSoon)
  const soon = rows.filter((r) => r.comingSoon)

  return (
    <section className="band-white section" id="states" aria-labelledby="states-title">
      <div className="shell">
        <div className="states" data-reveal>
          <div className="states__head">
            <div>
              <p className="eyebrow eyebrow--accent">Coverage</p>
              <h2 className="h2" id="states-title">
                Find your state’s path.
              </h2>
              <p className="lede">
                Requirements and consultation formats differ by state. This is the list intake checks against, kept
                current from the same data the form uses.
              </p>
            </div>
            {state === 'ready' && (
              <p className="states__legend">
                <span>
                  <i className="states__dot" aria-hidden="true" /> {open.length} open
                </span>
                <span>
                  <i className="states__dot states__dot--soon" aria-hidden="true" /> {soon.length} coming soon
                </span>
              </p>
            )}
          </div>

          {state === 'loading' && <p className="states__status">Checking current coverage…</p>}

          {state === 'failed' && (
            <p className="states__status">
              We could not load the live coverage list. Choose your state in the form above and we will tell you
              directly what is available.
            </p>
          )}

          {state === 'empty' && (
            <p className="states__status">
              The coverage list is empty right now, which usually means a temporary service issue. Please try again
              shortly or contact us.
            </p>
          )}

          {state === 'ready' && (
            <ul className="states__list" aria-label="State and territory coverage">
              {rows.map((row) => (
                <li className="states__row" key={row.code}>
                  <span className="states__name">{row.name}</span>
                  <span className={`tag ${row.comingSoon ? 'tag--sage' : 'tag--moss'}`}>
                    {row.comingSoon ? 'Coming soon' : 'Open'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
