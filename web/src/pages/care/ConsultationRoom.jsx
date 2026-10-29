/**
 * The consultation room.
 *
 * A scheduled appointment with a live countdown and, when the provider has
 * enabled it, a video or audio session. The timer is authoritative on the
 * server and arrives over SSE; the display only interpolates between updates,
 * so a refresh never resets an encounter and two clinicians never disagree
 * about how long is left.
 *
 * The video SDK is imported lazily inside `joinMedia`. It is a large
 * dependency and most visits are audio-only or never reach the room at all, so
 * it has no business in the initial bundle.
 */

import { useEffect, useRef, useState } from 'react'

export function ConsultationRoom({ id, appointment, isDoctor, csrf, onBack }) {
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => performance.now())
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [media, setMedia] = useState('idle') // idle | joining | live | error
  const [mediaError, setMediaError] = useState('')

  const localVideo = useRef(null)
  const remoteVideo = useRef(null)
  const room = useRef(null)
  // Guards against a late-resolving join landing after the patient has already
  // left and left the camera running.
  const mediaGeneration = useRef(0)

  const stopMedia = () => {
    mediaGeneration.current += 1
    try {
      room.current?.disconnect?.()
    } catch {
      // A room that has already torn itself down is not an error worth raising.
    }
    room.current = null
    for (const video of [localVideo.current, remoteVideo.current]) {
      video?.srcObject?.getTracks?.().forEach((track) => track.stop())
      if (video) video.srcObject = null
    }
  }

  // Hang up on unmount. An orphaned camera stream is the difference between a
  // patient closing a tab and their camera light staying on all evening.
  useEffect(() => stopMedia, [])

  const applySnapshot = (next) => {
    setSnapshot((previous) =>
      // Never let a slow response overwrite a newer one we already received.
      previous && previous.version > next.version ? previous : { ...next, receivedAt: performance.now() }
    )
    setError('')
  }

  useEffect(() => {
    let active = true
    const credentials = 'include'

    const refresh = async () => {
      try {
        const response = await fetch(`/api/v1/consultations/${id}`, { credentials })
        if (!active) return
        if (!response.ok) throw new Error('We could not load this consultation.')
        applySnapshot(await response.json())
      } catch (failure) {
        if (active) setError(failure.message)
      }
    }

    refresh()
    const stream = new EventSource(`/api/v1/consultations/${id}/events`)

    stream.addEventListener('snapshot', (event) => {
      try {
        const next = JSON.parse(event.data)
        if (active) applySnapshot(next)
      } catch {
        if (active) setError('We could not read that live update. Reopen the consultation to reconnect.')
      }
    })

    stream.addEventListener('access-ended', () => {
      stream.close()
      if (!active) return
      setSnapshot(null)
      setError('Live access has ended. Reopen the consultation to check your access.')
    })

    stream.onerror = () => {
      if (active) {
        setError('Live updates paused. Reconnecting…')
        refresh()
      }
    }

    const tick = window.setInterval(() => setNow(performance.now()), 1000)

    return () => {
      active = false
      stream.close()
      window.clearInterval(tick)
    }
  }, [id, csrf])

  const joinMedia = async () => {
    const generation = ++mediaGeneration.current
    const isCurrent = () => generation === mediaGeneration.current
    setMedia('joining')
    setMediaError('')

    try {
      const response = await fetch(`/api/v1/consultations/${id}/media`, { credentials: 'include' })
      if (!isCurrent()) return
      if (!response.ok) throw new Error('We could not start the video session for this appointment.')
      const grant = await response.json()

      const { Room, createLocalParticipant } = await import('@telnyx/video')
      if (!isCurrent()) return

      const live = new Room(grant.roomId, {
        clientToken: grant.token,
        localParticipant: createLocalParticipant({
          context: JSON.stringify({ role: isDoctor ? 'doctor' : 'patient' })
        })
      })
      if (!isCurrent()) {
        live.disconnect?.()
        return
      }

      room.current = live
      live.on('state_changed', (state) => {
        const streams = Object.values(state.streams ?? {})
        const local = streams.find((stream) => !stream.isRemote && stream.source)
        if (local && localVideo.current) localVideo.current.srcObject = local.source
        for (const stream of streams) {
          if (stream.isRemote && stream.source && stream.subscription?.status === 'unsubscribed') {
            live.subscribe(stream.id)?.catch?.(() => {})
          }
        }
        const remote = streams.find((stream) => stream.isRemote && stream.source)
        if (remoteVideo.current) remoteVideo.current.srcObject = remote ? remote.source : null
      })

      await live.connect()
      if (!isCurrent()) {
        live.disconnect?.()
        return
      }

      await live.publish('self', { constraints: { audio: true, video: appointment.mode === 'VIDEO' } })
      if (!isCurrent()) {
        live.disconnect?.()
        return
      }
      setMedia('live')
    } catch (failure) {
      if (!isCurrent()) return
      stopMedia()
      setMediaError(failure.message)
      setMedia('error')
    }
  }

  const action = async (command, seconds = 0) => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/v1/consultations/${id}/timer`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
        body: JSON.stringify({ version: snapshot.version, action: command, seconds })
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.reason?.message ?? 'That change did not go through.')
      setSnapshot({ ...result, receivedAt: performance.now() })
      setConfirmEnd(false)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  const serverNow = snapshot ? snapshot.serverNow + (now - snapshot.receivedAt) : now
  const remaining = snapshot
    ? Math.max(
        0,
        Math.ceil(
          snapshot.duration -
            snapshot.elapsed -
            (snapshot.runningSince === null ? 0 : Math.max(0, (serverNow - snapshot.runningSince) / 1000))
        )
      )
    : 0

  const audioOnly = appointment.mode === 'WEB_AUDIO'
  const when = new Date(appointment.starts_at).toLocaleString(undefined, {
    dateStyle: 'full',
    timeStyle: 'short'
  })

  return (
    <div className="room">
      <div className="room__head">
        <div>
          <p className="eyebrow">Consultation space</p>
          <h1 className="h3">Space for your conversation.</h1>
          <p className="field__hint">{when}</p>
        </div>
        <span className="tag tag--moss">{snapshot?.appointmentStatus?.toLowerCase() || 'Checking'}</span>
      </div>

      {error && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}

      <div className="room__grid">
        <section className="room__stage" aria-label="Consultation">
          {snapshot?.mediaAvailable ? (
            media === 'live' ? (
              <div className="room__live">
                <video ref={remoteVideo} autoPlay playsInline aria-label="The other participant" />
                <video ref={localVideo} autoPlay playsInline muted aria-label="You" />
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    stopMedia()
                    setMedia('idle')
                  }}
                >
                  Leave {audioOnly ? 'audio' : 'video'}
                </button>
              </div>
            ) : (
              <div className="room__placeholder">
                <h2 className="h4">
                  {snapshot?.status === 'ENDED' ? 'This consultation is complete.' : 'Your consultation space.'}
                </h2>
                <p className="card__body">
                  {audioOnly
                    ? 'Audio uses your microphone only. Your camera stays off, and nothing is recorded.'
                    : 'Video uses your camera and microphone once you join. Nothing is recorded.'}
                </p>
                {mediaError && (
                  <p className="notice notice--error" role="alert">
                    {mediaError}
                  </p>
                )}
                <button type="button" className="btn btn--forest" disabled={media === 'joining'} onClick={joinMedia}>
                  {media === 'joining' ? 'Connecting…' : audioOnly ? 'Join audio' : 'Join video'}
                </button>
              </div>
            )
          ) : (
            <div className="room__placeholder">
              <h2 className="h4">
                {snapshot?.status === 'ENDED' ? 'This consultation is complete.' : 'Your consultation space.'}
              </h2>
              <p className="card__body">
                Video is not connected for this consultation. No camera or microphone is in use.
              </p>
            </div>
          )}

          <p className="room__foot">
            <span>Recording off</span>
            <span>Patient information stays in your workspace</span>
          </p>
        </section>

        <section className="room__timer" aria-label="Consultation time">
          <p className="eyebrow">Consultation time</p>
          <p
            className="room__digits"
            role="timer"
            aria-label={
              snapshot
                ? `${Math.floor(remaining / 60)} minutes and ${remaining % 60} seconds remaining`
                : 'Loading the timer'
            }
          >
            {snapshot
              ? `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`
              : '—:—'}
          </p>
          <p className="tag tag--sage">{snapshot?.status?.toLowerCase() || 'loading'}</p>
          <p className="field__hint">
            {remaining === 0 && snapshot?.status === 'ACTIVE'
              ? 'Planned time reached. The clinician decides when the encounter ends.'
              : 'The server keeps the authoritative time. Refreshing this page does not reset it.'}
          </p>

          {isDoctor && snapshot && snapshot.status !== 'ENDED' && snapshot.appointmentStatus === 'CONFIRMED' && (
            <div className="room__controls">
              <button
                type="button"
                className="btn btn--forest"
                disabled={busy}
                onClick={() => action(snapshot.status === 'READY' ? 'start' : snapshot.status === 'PAUSED' ? 'resume' : 'pause')}
              >
                {snapshot.status === 'READY'
                  ? 'Start the encounter'
                  : snapshot.status === 'PAUSED'
                    ? 'Resume the timer'
                    : 'Pause the timer'}
              </button>

              <div className="room__pair">
                <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => action('extend', 300)}>
                  +5 minutes
                </button>
                <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => action('extend', 600)}>
                  +10 minutes
                </button>
              </div>

              <form
                className="field"
                onSubmit={(event) => {
                  event.preventDefault()
                  const minutes = Number(new FormData(event.currentTarget).get('minutes'))
                  action('set', minutes * 60)
                }}
              >
                <label className="field__label" htmlFor="room-duration">
                  Planned duration in minutes
                </label>
                <input
                  className="field__control"
                  id="room-duration"
                  name="minutes"
                  type="number"
                  min="1"
                  max="240"
                  defaultValue={snapshot.duration / 60}
                  required
                />
                <button type="submit" className="btn btn--quiet" disabled={busy}>
                  Set duration
                </button>
              </form>

              {['ACTIVE', 'PAUSED'].includes(snapshot.status) &&
                (confirmEnd ? (
                  <div className="notice notice--warn">
                    <strong>Mark this encounter complete?</strong>
                    <p>This closes the appointment record.</p>
                    <div className="room__pair">
                      <button type="button" className="btn btn--forest" disabled={busy} onClick={() => action('end')}>
                        Confirm completion
                      </button>
                      <button type="button" className="btn btn--quiet" onClick={() => setConfirmEnd(false)}>
                        Keep it open
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="btn btn--quiet" onClick={() => setConfirmEnd(true)}>
                    End the encounter
                  </button>
                ))}
            </div>
          )}
        </section>
      </div>

      {onBack && (
        <button type="button" className="btn btn--quiet" onClick={onBack}>
          Back to appointments
        </button>
      )}
    </div>
  )
}
