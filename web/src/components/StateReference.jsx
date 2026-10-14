/**
 * Home page state reference.
 *
 * Rebuilt from the production bundle that shipped to Vercel on 2026-10-14. The
 * markup below is a faithful transcription of that build: same class names, same
 * copy, same order, so the stylesheet in `styles/recovered.css` applies as
 * written.
 *
 * A jurisdiction with no documented program fee reads "not confirmed", never
 * "free" — the fallback wording is status-dependent on purpose.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { stateReferenceRows } from '../lib/resourceCentre.js'

export function StateReference() {
  const [code, setCode] = useState('CA')
  const [query, setQuery] = useState('')

  const selected = stateReferenceRows.find((row) => row.code === code) ?? stateReferenceRows[0]
  const matches = stateReferenceRows.filter((row) =>
    `${row.state} ${row.code}`.toLowerCase().includes(query.trim().toLowerCase())
  )

  return (
    <section className="section band-sage state-reference" id="state-reference" aria-labelledby="state-reference-title">
      <div className="shell">
        <div className="section-head" data-reveal="fade">
          <div>
            <p className="eyebrow eyebrow--accent">Before your first purchase</p>
            <h2 className="h2" id="state-reference-title">
              Different states.
              <span className="serif grad-text"> Different next steps.</span>
            </h2>
          </div>
          <p className="lede">
            A clinician evaluation and state program access are not the same thing. Compare required
            documents and government fees for all 50 states and Washington DC.
          </p>
        </div>

        <div className="state-reference__lookup">
          <div>
            <label htmlFor="state-reference-select">Choose your state</label>
            <select id="state-reference-select" value={code} onChange={(e) => setCode(e.target.value)}>
              {stateReferenceRows.map((row) => (
                <option key={row.code} value={row.code}>
                  {row.state}
                </option>
              ))}
            </select>
            <p className="state-reference__scope">
              Standard patient pathways, not a quote for every caregiver, visitor, minor, or hardship
              application. State program status is separate from MmjGreen service availability.
            </p>
          </div>

          <article className="state-reference__selected" aria-live="polite" aria-atomic="true">
            <span className="tag tag--moss">{selected.status}</span>
            <h3 className="h4">{selected.state}</h3>
            <dl>
              <div>
                <dt>After certification</dt>
                <dd>{selected.nextStep}</dd>
              </div>
              <div>
                <dt>State program fee</dt>
                <dd>{selected.fee}</dd>
              </div>
            </dl>
            <div className="state-reference__links">
              <Link className="text-link" to={`/blog/${selected.slug}`}>
                Read {selected.state} rules ↗
              </Link>
              <a
                className="text-link"
                href={selected.sources[0].url}
                target="_blank"
                rel="noreferrer"
              >
                Check the official source ↗
              </a>
            </div>
          </article>
        </div>

        <p className="state-reference__note">
          Reference based on state guides source-reviewed September 30, 2026. Clinical evaluation fees
          and product costs are separate. Reductions, waivers, card options, and processing charges
          may change; check official instructions before paying. Tribal programs can have separate
          rules.
        </p>

        <details className="state-reference__compare">
          <summary>
            Compare all 50 states and Washington DC{' '}
            <span aria-hidden="true">+</span>
          </summary>

          <div className="state-reference__search">
            <label htmlFor="state-reference-search">Find a state or abbreviation</label>
            <input
              id="state-reference-search"
              type="search"
              placeholder="Pennsylvania or PA"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <p role="status">
              {matches.length} matching {matches.length === 1 ? 'jurisdiction' : 'jurisdictions'}
            </p>
          </div>

          {matches.length ? (
            <div
              className="state-reference__scroll"
              tabIndex={0}
              role="region"
              aria-label="State fee and access comparison"
            >
              <ul className="state-reference__list">
                {matches.map((row) => (
                  <li key={row.code}>
                    <div>
                      <h3>{row.state}</h3>
                      <span className="tag tag--sage">{row.status}</span>
                    </div>
                    <div>
                      <strong>After certification</strong>
                      <p>{row.nextStep}</p>
                    </div>
                    <div>
                      <strong>State program fee</strong>
                      <p>{row.fee}</p>
                      <Link className="text-link" to={`/blog/${row.slug}`}>
                        Read {row.state} rules ↗
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="state-reference__empty">
              No matching state. Try the full name or its two letter abbreviation.
            </p>
          )}
        </details>
      </div>
    </section>
  )
}