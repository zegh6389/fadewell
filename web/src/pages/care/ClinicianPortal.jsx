import { useCallback, useEffect, useState } from 'react'
import { Workspace, CareNotice, CareLoader } from './Workspace.jsx'
import {
  addNote,
  createAvailability,
  deleteAvailability,
  getIntakeById,
  getWorkspace
} from '../../lib/api.js'
import { ConsultationRoom } from './ConsultationRoom.jsx'
import { DateTimePicker } from './DateTimePicker.jsx'
import { formatWhen } from '../../lib/datetime.js'

/* ---------- Clinician surface ---------------------------------- */

function ClinicianSurface({ session }) {
  const [state, setState] = useState('loading')
  const [data, setData] = useState({ intakes: [], appointments: [], availability: [] })
  const [selected, setSelected] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

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

  async function saveNote() {
    if (!note.trim() || !selected) return
    setBusy(true)
    setError(null)
    try {
      await addNote(selected.id, { body: note.trim() }, session.csrf)
      setNote('')
      await openIntake(selected.id)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const [windowStart, setWindowStart] = useState('')
  const [open, setOpen] = useState(null)

  async function publishWindow() {
    setBusy(true)
    setError(null)
    try {
      // A window runs from the chosen start until the end of that day, so the
      // clinician opens the hours they are actually free rather than a fixed
      // three-hour block at nine in the morning.
      const start = windowStart || `${today}T09:00`
      const endsAt = `${start.slice(0, 10)}T17:00:00.000Z`
      await createAvailability({ startsAt: `${start}:00.000Z`, endsAt, mode: 'VIDEO' }, session.csrf)
      setWindowStart('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const upcoming = data.appointments
    .filter((a) => a.status === 'CONFIRMED' && new Date(a.starts_at) > new Date())
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))

  return (
    <div className="care__stack">
      <div className="care__head">
        <div>
          <p className="eyebrow eyebrow--accent">Clinician workspace</p>
          <h1 className="h2">Your day, with room for care.</h1>
        </div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={load}>
          Refresh
        </button>
      </div>

      {error ? <CareNotice tone="error">{error}</CareNotice> : null}
      {state === 'loading' ? <CareLoader /> : null}

      {open ? (
        <section className="care__card">
          <ConsultationRoom
            id={open.consultationId ?? open.id}
            appointment={open}
            isDoctor
            csrf={session.csrf}
            onBack={() => setOpen(null)}
          />
        </section>
      ) : null}

      <section className="care__card">
        <h2 className="h4">Next up</h2>
        {upcoming.length ? (
          <ul className="care__appointments">
            {upcoming.map((appointment) => (
              <li key={appointment.id}>
                <span className="care__appt-when">{formatWhen(appointment.starts_at)}</span>
                <span className="tag tag--moss">{appointment.mode.replace('_', ' ')}</span>
                <button
                  type="button"
                  className="btn btn--quiet btn--sm"
                  onClick={() => setOpen(appointment)}
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="float-card__meta">No consultations scheduled.</p>
        )}
      </section>

      <section className="care__card">
        <div className="care__card-head">
          <h2 className="h4">Your availability</h2>
          <button type="button" className="btn btn--primary btn--sm" onClick={publishWindow} disabled={busy}>
            Open a window from{' '}
            {windowStart ? new Date(windowStart).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'today, 09:00'}
          </button>
        </div>

        <DateTimePicker name="window-start" label="Window start" onChange={setWindowStart} />

        {data.availability.length ? (
          <ul className="care__appointments">
            {data.availability.map((slot) => (
              <li key={slot.id}>
                <span className="care__appt-when">
                  {formatWhen(slot.starts_at)} – {formatWhen(slot.ends_at)}
                </span>
                <span className="tag">{slot.booked ?? 0} booked</span>
                <button
                  type="button"
                  className="btn btn--quiet btn--sm"
                  onClick={async () => {
                    setBusy(true)
                    try {
                      await deleteAvailability(slot.id, session.csrf)
                      await load()
                    } catch (err) {
                      setError(err.message)
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="float-card__meta">
            No availability published. Operations can only book you into windows you open.
          </p>
        )}
      </section>

      <section className="care__card">
        <h2 className="h4">Assigned evaluations</h2>
        {data.intakes.length ? (
          <ul className="care__list">
            {data.intakes.map((intake) => (
              <li key={intake.id} className="care__row-item">
                <div>
                  <p className="care__row-title">{intake.name}</p>
                  <p className="float-card__meta">
                    {intake.state.replace(/_/g, ' ').toLowerCase()} · updated {formatWhen(intake.updatedAt)}
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
          <p className="float-card__meta">Nothing assigned to you yet.</p>
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
              <dt>Preferred mode</dt>
              <dd>{selected.data?.mode}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{selected.state?.replace(/_/g, ' ').toLowerCase()}</dd>
            </div>
          </dl>

          <p className="care__reason">{selected.data?.reason}</p>

          {Object.entries(selected.data?.answers ?? {}).map(([key, value]) => (
            <div className="care__answer" key={key}>
              <p className="care__answer-key">{key.replace(/_/g, ' ')}</p>
              <p className="card__body">{value}</p>
            </div>
          ))}

          <label className="field">
            <span className="field__label">Add a clinical note</span>
            <textarea
              className="field__control field__control--area"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={4000}
            />
          </label>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={saveNote}
            disabled={busy || !note.trim()}
          >
            Save note
          </button>
        </section>
      ) : null}
    </div>
  )
}

export default function ClinicianPortal() {
  return <Workspace area="portal" role="DOCTOR" Surface={ClinicianSurface} />
}
