import { useCallback, useEffect, useState } from 'react'
import { Workspace, CareNotice, CareLoader } from './Workspace.jsx'
import { getAuditLog, getDeliveryQueue, listUsers, updateUser } from '../../lib/api.js'
import { IconArrow, IconCheck, IconShield } from '../../components/Icons.jsx'

const ROLES = ['PATIENT', 'DOCTOR', 'STAFF', 'ADMIN']

function formatWhen(value) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function AdminSurface() {
  const [state, setState] = useState('loading')
  const [users, setUsers] = useState([])
  const [audit, setAudit] = useState([])
  const [delivery, setDelivery] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [flash, setFlash] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    // Each panel is independent — a failure in one must not blank the others.
    const [usersResult, auditResult, deliveryResult] = await Promise.allSettled([
      listUsers(),
      getAuditLog(),
      getDeliveryQueue()
    ])
    if (usersResult.status === 'fulfilled') setUsers(usersResult.value?.users ?? [])
    if (auditResult.status === 'fulfilled') setAudit(auditResult.value?.events ?? auditResult.value ?? [])
    if (deliveryResult.status === 'fulfilled') setDelivery(deliveryResult.value)
    const failure = [usersResult, auditResult, deliveryResult].find((r) => r.status === 'rejected')
    if (failure) setError(failure.reason?.message ?? 'Some panels could not be loaded.')
    setState('ready')
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function toggleUser(user) {
    setBusy(true)
    setError(null)
    try {
      await updateUser(user.id, { enabled: !user.enabled })
      setFlash(`${user.displayName ?? user.id} ${user.enabled ? 'disabled' : 're-enabled'}.`)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="care__stack">
      <div className="care__head">
        <div>
          <p className="eyebrow eyebrow--accent">Administration</p>
          <h1 className="h2">A considered view of every action.</h1>
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

      <section className="care__card">
        <h2 className="h4">Access</h2>
        {users.length ? (
          <ul className="care__list">
            {users.map((user) => (
              <li key={user.id} className="care__row-item">
                <div>
                  <p className="care__row-title">{user.displayName ?? user.email ?? user.id}</p>
                  <p className="float-card__meta">
                    <span className="tag">{user.role}</span> {user.enabled ? '· Active' : '· Disabled'}
                  </p>
                </div>
                <button
                  type="button"
                  className={`btn btn--sm ${user.enabled ? 'btn--ghost' : 'btn--primary'}`}
                  onClick={() => toggleUser(user)}
                  disabled={busy}
                >
                  {user.enabled ? 'Disable' : 'Enable'}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="float-card__meta">No accounts visible.</p>
        )}
      </section>

      <section className="care__card">
        <h2 className="h4">Delivery readiness</h2>
        {delivery ? (
          <dl className="care__dl">
            <div>
              <dt>Notifications</dt>
              <dd>{delivery.enabled ? 'Enabled' : 'Disabled'}</dd>
            </div>
            <div>
              <dt>Queued</dt>
              <dd>{delivery.queued ?? delivery.pending ?? 0}</dd>
            </div>
            <div>
              <dt>Sent (24h)</dt>
              <dd>{delivery.sent ?? 0}</dd>
            </div>
            <div>
              <dt>Failed</dt>
              <dd>{delivery.failed ?? 0}</dd>
            </div>
          </dl>
        ) : (
          <p className="float-card__meta">Delivery metrics are not available.</p>
        )}
      </section>

      <section className="care__card">
        <h2 className="h4">Recent activity</h2>
        {Array.isArray(audit) && audit.length ? (
          <ul className="care__list care__list--dense">
            {audit.slice(0, 40).map((event, index) => (
              <li key={event.id ?? index} className="care__row-item">
                <div>
                  <p className="care__row-title">{event.action}</p>
                  <p className="float-card__meta">
                    {event.actor_role?.toLowerCase() ?? 'system'} · {event.resource_type ?? '—'}
                  </p>
                </div>
                <span className="float-card__meta">{event.created_at ? formatWhen(event.created_at) : ''}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="float-card__meta">No audit events recorded yet.</p>
        )}
      </section>

      <p className="care__fineprint">
        <IconShield size={14} /> Every access to a patient record is logged here. If something looks
        wrong, investigate before it is escalated.
      </p>
    </div>
  )
}

export default function AdminConsole() {
  return <Workspace area="admin" role="ADMIN" Surface={AdminSurface} />
}
