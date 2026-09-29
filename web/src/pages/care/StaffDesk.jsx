import { useCallback, useEffect, useState } from 'react'
import { Workspace, CareNotice, CareLoader } from './Workspace.jsx'
import {
  addNote,
  bookAppointment,
  getIntakeById,
  getWorkspace,
  reviewIntake,
  verifyContact
} from '../../lib/api.js'
import { IconArrow, IconCalendar, IconCheck, IconClock } from '../../components/Icons.jsx'

const QUEUES = [
  { key: 'NEEDS_REVIEW', label: 'Needs attention', tone: 'amber' },
  { key: 'SUBMITTED', label: 'Awaiting review', tone: 'moss' },
  { key: 'REVIEWED', label: 'Ready to schedule', tone: 'lime' },
  { key: 'SCHEDULED', label: 'Scheduled', tone: 'forest' },
  { key: 'COMPLETED', label: 'Complete', tone: 'forest' },
  { key: 'DRAFT', label: 'Draft', tone: 'sage' }
]

function formatWhen(value) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function StaffSurface({ session }) {
  const [state, setState] = useState('loading')
  const [data, setData] = useState({ intakes: [], appointments: [], availability: [] })
  const [queue, setQueue] = useState('NEEDS_REVIEW')
  const [selected, setSelected] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [flash, setFlash] = useState(null)

  const load = useCallback(async () => {
    try {
      const workspace = await getWorkspace()
      setData({
        intakes: workspace.intakes ?? [],
        appointments: workspace.appointments ?? [],
        availability: workspace.availability ?? []
      })
      setState('ready')
    } catch (err) {
      setError(err.message)
      setState('ready')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function openIntake(id) {
    setBusy(true)
    setError(null)
    try {
      const detail = await getIntakeById(id)
      setSelected(detail.intake ?? detail)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function act(fn, message) {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      await fn()
      setFlash(message)
      await openIntake(selected.id)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const visible = data.intakes.filter((intake) => intake.state === queue)
  const openSlots = data.availability.filter((slot) => (slot.booked ?? 0) === 0)

  return (
    <div className="care__stack">
      <div className="care__head">
        <div>
          <p className="eyebrow eyebrow--accent">Care operations</p>
          <h1 className="h2">Every next step has a home.</h1>
        </div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={load}>
          Refresh
        </button>
      </div>

      {error ? <CareNotice tone="error">{error}</CareNotice> : null}
      {flash ? (
        <CareNotice tone="ok">
          {flash}
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setFlash(null)}>
            Dismiss
          </button>
        </CareNotice>
      ) : null}
      {state === 'loading' ? <CareLoader /> : null}

      <div className="switcher" role="tablist" aria-label="Intake queues">
        {QUEUES.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={queue === item.key}
            className="switcher__btn"
            onClick={() => setQueue(item.key)}
          >
            {item.label}
            <span className="switcher__count">
              {data.intakes.filter((i) => i.state === item.key).length}
            </span>
          </button>
        ))}
      </div>

      <section className="care__card">
        <h2 className="h4">
          {QUEUES.find((q) => q.key === queue)?.label} · {visible.length}
        </h2>
        {visible.length ? (
          <ul className="care__list">
            {visible.map((intake) => (
              <li key={intake.id} className="care__row-item">
                <div>
                  <p className="care__row-title">{intake.name}</p>
                  <p className="float-card__meta">
                    Updated {formatWhen(intake.updatedAt)}
                    {intake.issues?.length ? ` · ${intake.issues.length} issue(s)` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => openIntake(intake.id)}
                  disabled={busy}
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="float-card__meta">Nothing in this queue.</p>
        )}
      </section>

      {selected ? (
        <section className="care__card care__card--detail">
          <div className="care__card-head">
            <h2 className="h4">
              {selected.data?.firstName} {selected.data?.lastName}
            </h2>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>

          <dl className="care__dl">
            <div>
              <dt>State</dt>
              <dd>{selected.data?.state}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{selected.data?.email || '—'}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{selected.data?.phone || '—'}</dd>
            </div>
            <div>
              <dt>Contact verified</dt>
              <dd>{selected.contactVerified ? 'Yes' : 'No'}</dd>
            </div>
          </dl>

          <p className="care__reason">{selected.data?.reason}</p>

          <div className="care__actions care__actions--wrap">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={busy || selected.contactVerified}
              onClick={() =>
                act(
                  () => verifyContact(selected.id, { version: selected.version }, session.csrf),
                  'Contact marked as verified.'
                )
              }
            >
              <IconCheck size={15} /> Mark contact verified
            </button>

            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={busy || selected.state === 'REVIEWED' || selected.state === 'SCHEDULED'}
              onClick={() =>
                act(
                  () =>
                    reviewIntake(
                      selected.id,
                      { version: selected.version, decision: 'APPROVED' },
                      session.csrf
                    ),
                  'Intake approved and moved to scheduling.'
                )
              }
            >
              Approve for scheduling
            </button>
          </div>

          {selected.state === 'REVIEWED' ? (
            <div className="care__book">
              <h3 className="h4">Book a consultation</h3>
              {openSlots.length ? (
                <ul className="care__list">
                  {openSlots.map((slot) => (
                    <li key={slot.id} className="care__row-item">
                      <span className="care__appt-when">
                        {formatWhen(slot.starts_at)} – {formatWhen(slot.ends_at)}
                      </span>
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        disabled={busy}
                        onClick={() =>
                          act(
                            () =>
                              bookAppointment(
                                {
                                  intakeId: selected.id,
                                  availabilityId: slot.id,
                                  mode: slot.mode,
                                  version: selected.version
                                },
                                session.csrf
                              ),
                            'Consultation booked.'
                          )
                        }
                      >
                        <IconCalendar size={15} /> Book
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="float-card__meta">
                  No open clinician availability. Ask a clinician to publish a window.
                </p>
              )}
            </div>
          ) : null}

          <label className="field">
            <span className="field__label">Administrative note</span>
            <textarea
              className="field__control field__control--area"
              rows={3}
              value={note}
              maxLength={4000}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Record a contact attempt or context for the next person."
            />
          </label>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={busy || !note.trim()}
            onClick={() =>
              act(async () => {
                await addNote(selected.id, { body: note.trim() }, session.csrf)
                setNote('')
              }, 'Note recorded.')
            }
          >
            Save note
          </button>
        </section>
      ) : null}
    </div>
  )
}

export default function StaffDesk() {
  return <Workspace area="staff" role="STAFF" Surface={StaffSurface} />
}
