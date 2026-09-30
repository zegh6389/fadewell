// Security headers for private routes (/patient|/portal|/staff|/admin).
// Previously declared in web/vercel.json when the marketing site was
// hosted on Vercel; now applied by the Fastify host so headers are present
// regardless of where the bundle ships from.
export const PRIVATE_ROUTE_PATTERN = /^\/(patient|portal|staff|admin)(?:[/?]|$)/

/**
 * The subset of private routes that mount the consultation room and therefore
 * need camera and microphone. Narrower than PRIVATE_ROUTE_PATTERN on purpose:
 * staff and admin are back-office surfaces and never open a media device.
 */
export const CONSULTATION_ROUTE_PATTERN = /^\/(patient|portal)(?:[/?]|$)/

export const PRIVATE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.telnyx.com wss://video.telnyx.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"

export const PRIVATE_PERMISSIONS = 'camera=(self), microphone=(self), geolocation=()'
export const STAFF_PERMISSIONS = 'camera=(), microphone=(), geolocation=()'

export function isStaffRoute(path: string): boolean {
  return /^\/(staff|admin)(?:[/?]|$)/.test(path)
}