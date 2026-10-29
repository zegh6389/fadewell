/**
 * MyFloraMD — session layer for the care workspaces.
 *
 * Workforce sign-in is username + password followed by a TOTP step; patients
 * never authenticate — the service issues a guest intake session so a person
 * can complete an intake without an account. Session state lives in an
 * HttpOnly cookie; this module only reads the CSRF token the session returns.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { CareError } from './api.js'

async function authRequest(path, { method = 'GET', body } = {}) {
  let response
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } catch {
    throw new CareError('We could not reach the care service.', 0, 'OFFLINE')
  }

  const type = response.headers.get('content-type') ?? ''
  if (!type.includes('application/json')) {
    throw new CareError('The care service is not connected yet.', 503, 'UNAVAILABLE')
  }

  const data = await response.json().catch(() => null)
  if (!response.ok || data?.error) {
    throw new CareError(
      data?.error?.message ?? 'That did not work. Please try again.',
      response.status,
      data?.error?.code ?? 'UNAVAILABLE'
    )
  }
  return data
}

export const getAuthStatus = () => authRequest('/auth/status')
export const login = (username, password) =>
  authRequest('/auth/login', { method: 'POST', body: { username, password } })
export const getPending = () => authRequest('/auth/pending')
export const submitMfa = (code) => authRequest('/auth/mfa', { method: 'POST', body: { code } })
export const startGuestIntake = () => authRequest('/auth/guest', { method: 'POST', body: {} })
export const signOut = () => authRequest('/auth/logout', { method: 'POST' })
export const getSession = () => authRequest('/v1/session')

/**
 * Tracks the current session for a workspace.
 *
 * @param {string|null} role  Restrict to a role; a session with a different
 *                            role is treated as signed out for that surface.
 */
export function useSession(role) {
  const [session, setSession] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready | unavailable
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    let cancelled = false

    getSession()
      .then((data) => {
        if (cancelled || !mounted.current) return
        setSession(role && data.role !== role ? null : data)
        setStatus('ready')
      })
      .catch(() => {
        if (cancelled || !mounted.current) return
        setSession(null)
        setStatus('ready')
      })

    return () => {
      cancelled = true
      mounted.current = false
    }
  }, [role])

  const end = useCallback(async () => {
    try {
      await signOut()
    } catch {
      // A failed sign-out still clears local state — the cookie may already be gone.
    }
    setSession(null)
  }, [])

  return { session, status, setSession, end }
}

/** Tracks whether the service has intake and identity configured at all. */
export function useServiceStatus() {
  const [info, setInfo] = useState(null)
  const [state, setState] = useState('loading')

  useEffect(() => {
    let cancelled = false
    getAuthStatus()
      .then((data) => {
        if (cancelled) return
        setInfo(data)
        setState('ready')
      })
      .catch(() => {
        if (cancelled) return
        setInfo(null)
        setState('unavailable')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { info, state }
}
