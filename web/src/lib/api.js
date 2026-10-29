/**
 * MyFloraMD — API client.
 *
 * Binds to the MyFloraMD Fastify service (api/). The browser only ever calls
 * same-origin `/api` — the service serves this bundle and the API from the
 * same origin, which the strict `connect-src 'self'` CSP requires.
 *
 * Session state is an HttpOnly cookie issued by the service; this layer only
 * ever carries the CSRF token the session payload returns.
 */

export class CareError extends Error {
  constructor(message, status = 503, code = 'UNAVAILABLE') {
    super(message)
    this.name = 'CareError'
    this.status = status
    this.code = code
  }
}

const DEFAULT_TIMEOUT = 15000

async function request(path, { method = 'GET', body, csrf, timeout = DEFAULT_TIMEOUT } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  let response
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new CareError(
      'We could not reach the care service. Your changes were not saved — please try again.',
      0,
      'OFFLINE'
    )
  } finally {
    clearTimeout(timer)
  }

  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new CareError('The care service is not connected yet. Please try again shortly.')
  }

  let data
  try {
    data = await response.json()
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new CareError('We could not read the response from the care service.')
  }

  if (!response.ok || data?.error) {
    const status = response.ok ? 503 : response.status
    const serverMessage = typeof data?.error?.message === 'string' ? data.error.message : ''
    const code = typeof data?.error?.code === 'string' ? data.error.code : 'UNAVAILABLE'

    // 400/409/422 faults are written for patients — surface them verbatim.
    if ((status === 400 || status === 409 || status === 413 || status === 422) && serverMessage) {
      throw new CareError(serverMessage, status, code)
    }

    const messages = {
      400: 'Check the information you entered and try again.',
      401: 'Your secure session has ended. Your information is safe — use the link in your confirmation message to return.',
      403: 'Your account does not have access to that action.',
      404: 'That record is not available in this session.',
      409: 'This record changed while you were working. Refresh and try again.',
      413: 'That file is too large to upload.',
      415: 'That request format is not supported.',
      429: 'Please wait a moment before trying again.',
      503: 'The care service is not available yet. Please try again shortly.'
    }
    throw new CareError(messages[status] || 'We could not complete that request.', status, code)
  }

  return data
}

/* ---------- Public reference data ---------------------------- */

export const getQuestionnaire = (opts) => request('/questionnaire', opts)
export const getJurisdictions = (opts) => request('/jurisdictions', opts)

/**
 * One turn with the care guide. The conversation state is echoed back so the
 * next turn can keep context; the service owns the replies and the safety
 * flag, the browser never decides what is safe to say.
 */
export const postChat = (body, opts) => request('/chat', { ...opts, method: 'POST', body })

/* ---------- Patient ------------------------------------------ */

export const getIntake = (opts) => request('/intake', opts)
export const saveIntake = (body, csrf, opts) =>
  request('/intake', { ...opts, method: 'PUT', body, csrf })
export const uploadIdDocument = (body, csrf, opts) =>
  request('/intake/id-document', { ...opts, method: 'POST', body, csrf })
export const submitIntake = (body, csrf, opts) =>
  request('/intake/submit', { ...opts, method: 'POST', body, csrf })

/* ---------- Shared workspace --------------------------------- */

export const getWorkspace = (opts) => request('/workspace', opts)
export const getIntakeById = (id, opts) => request(`/intakes/${encodeURIComponent(id)}`, opts)
export const getDeliveryQueue = (opts) => request('/delivery', opts)

/* ---------- Clinical / operations ---------------------------- */

export const verifyContact = (id, body, csrf, opts) =>
  request(`/intakes/${encodeURIComponent(id)}/verify-contact`, { ...opts, method: 'POST', body, csrf })
export const reviewIntake = (id, body, csrf, opts) =>
  request(`/intakes/${encodeURIComponent(id)}/review`, { ...opts, method: 'POST', body, csrf })
export const addNote = (id, body, csrf, opts) =>
  request(`/intakes/${encodeURIComponent(id)}/notes`, { ...opts, method: 'POST', body, csrf })

export const createAvailability = (body, csrf, opts) =>
  request('/availability', { ...opts, method: 'POST', body, csrf })
export const deleteAvailability = (id, csrf, opts) =>
  request(`/availability/${encodeURIComponent(id)}`, { ...opts, method: 'DELETE', csrf })

export const bookAppointment = (body, csrf, opts) =>
  request('/appointments', { ...opts, method: 'POST', body, csrf })

/* ---------- Administration ----------------------------------- */

export const getAuditLog = (opts) => request('/admin/audit', opts)
export const listUsers = (opts) => request('/admin/users', opts)
export const updateUser = (id, body, opts) =>
  request(`/admin/users/${encodeURIComponent(id)}`, { ...opts, method: 'PATCH', body })
export const setPassword = (id, body, opts) =>
  request(`/admin/users/${encodeURIComponent(id)}/password`, { ...opts, method: 'PATCH', body })
