import { z } from 'zod'
import type { Questionnaire } from './questionnaire.ts'

export class Fault extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}
export const conflict = () =>
  new Fault(409, 'CONFLICT', 'This record has changed. Refresh before trying again.')
export const unavailable = () =>
  new Fault(503, 'UNAVAILABLE', 'This service is not available yet. Please try again later.')
export const denied = () =>
  new Fault(403, 'FORBIDDEN', 'Your account does not have access to this action.')
export const missing = () => new Fault(404, 'NOT_FOUND', 'This record is not available.')
export const uuid = z.string().uuid()
export const roles = ['PATIENT', 'DOCTOR', 'STAFF', 'ADMIN'] as const
export type Role = (typeof roles)[number]
export type Actor = { id: string; role: Role; sessionHash: string; csrf: string; expiresAt: string; joinAppointmentId: string | null }

export const questionnaire = {
  version: '2026-09-initial',
  title: 'Prepare for your evaluation',
  questions: [
    { id: 'goals', label: 'What would you like to discuss with your clinician?', required: true },
    {
      id: 'history',
      label: 'What medical history should your clinician know about?',
      required: true
    },
    {
      id: 'medications',
      label:
        'Which medications or supplements do you currently take? Write “none” if there are none.',
      required: true
    },
    {
      id: 'allergies',
      label: 'Do you have any known allergies? Write “none” if there are none.',
      required: true
    }
  ]
}

// US state code (ISO 3166-2 two-letter) the patient declares as their jurisdiction for this intake.
// Validated against the `jurisdictions` table by the route handler before save.
export const stateCode = z
  .string()
  .min(2)
  .max(2)
  .regex(/^[A-Z]{2}$/, 'state must be a two-letter uppercase jurisdiction code')
export const intakeInput = z.strictObject({
  version: z.number().int().min(0),
  requestKey: uuid.optional(),
  firstName: z.string().max(100),
  lastName: z.string().max(100),
  email: z.string().max(254),
  phone: z.string().max(50),
  state: stateCode,
  reason: z.string().max(4000),
  mode: z.enum(['VIDEO', 'WEB_AUDIO', 'PHONE', 'EITHER']),
  smsConsent: z.boolean(),
  emailConsent: z.boolean(),
  // Free-form: the questionnaire definition determines which keys are valid (see validateIntake).
  answers: z.record(z.string().min(1).max(100), z.string().max(4000))
})
export type IntakeInput = z.infer<typeof intakeInput>
export class UnknownAnswerKeyError extends Fault {
  constructor(key: string) {
    super(400, 'UNKNOWN_ANSWER_KEY', `Answer key "${key}" is not part of the active questionnaire.`)
  }
}
export class JurisdictionUnknownError extends Fault {
  constructor(code: string) {
    super(422, 'JURISDICTION_UNKNOWN', `Jurisdiction "${code}" is not in the directory.`)
  }
}
export class JurisdictionNotSupportedError extends Fault {
  constructor(code: string) {
    super(422, 'JURISDICTION_NOT_SUPPORTED', `FadeWell does not operate in jurisdiction "${code}" yet.`)
  }
}
export class JurisdictionComingSoonError extends Fault {
  constructor(code: string) {
    super(
      422,
      'JURISDICTION_COMING_SOON',
      `Jurisdiction "${code}" is not accepting new patients yet. Join the waitlist to be notified.`
    )
  }
}
export class VisitTypeNotAllowedError extends Fault {
  constructor(code: string, mode: string) {
    super(
      422,
      'VISIT_TYPE_NOT_ALLOWED',
      `Visit mode "${mode}" is not permitted in jurisdiction "${code}".`
    )
  }
}
// Restrict the API to OZ_PER_30D only. The DB CHECK constraint still
// permits GRAMS_THC_PER_30D, PERCENT_THC, and SUPPLY_DAYS so future schema
// changes for those units do not need a migration, but the API boundary
// refuses every non-OZ value today. The routes code compares input.amountOz
// directly to the cap and stores it in an amount_oz column; accepting a
// non-OZ metric here would store "5 grams" in a column named amount_oz and
// silently disagree with the row's metric label. When metric-specific units
// are wired end-to-end (either per-metric columns or explicit unit
// conversion in the cap/amount comparison), extend this enum and the
// routing logic together.
export const prescriptionMetric = z.enum(['OZ_PER_30D'])
export const prescriptionInput = z.strictObject({
  amountOz: z.number().positive().max(100),
  metric: prescriptionMetric.optional().default('OZ_PER_30D'),
  periodDays: z.number().int().min(1).max(365).optional().default(30),
  refillsRemaining: z.number().int().min(0).max(0).optional().default(0),
  notes: z.string().max(4000).optional()
})
export type PrescriptionInput = z.infer<typeof prescriptionInput>
export class PrescriptionCapExceededError extends Fault {
  constructor(code: string, metric: string, requested: number, max: number) {
    super(
      422,
      'PRESCRIPTION_CAP_EXCEEDED',
      `Prescription for ${requested} ${metric} exceeds jurisdiction "${code}" cap of ${max} ${metric}.`
    )
  }
}
export class PrescriptionNoCapDefinedError extends Fault {
  constructor(code: string, metric: string) {
    super(
      422,
      'PRESCRIPTION_NO_CAP_DEFINED',
      `No active ${metric} cap is defined for jurisdiction "${code}". Refusing to issue an uncapped prescription.`
    )
  }
}
export class PrescriptionCumulativeExceededError extends Fault {
  constructor(code: string, metric: string, runningTotal: number, requested: number, cap: number, periodDays: number) {
    super(
      422,
      'PRESCRIPTION_CUMULATIVE_EXCEEDED',
      `Prescription for ${requested} ${metric} would bring the running ${periodDays}-day total to ${(runningTotal + requested).toFixed(2)} ${metric} for jurisdiction "${code}", exceeding the cap of ${cap}.`
    )
  }
}
/**
 * Map a patient-declared intake mode to the set of jurisdiction visit_type values that satisfy it.
 *   VIDEO | WEB_AUDIO -> VIDEO (WEB_AUDIO is the audio fallback of a video consultation)
 *   PHONE            -> PHONE
 *   EITHER           -> either VIDEO or PHONE; the patient is flexible so any single match satisfies.
 * Returns the empty array for unrecognised modes so the caller can short-circuit to a 422.
 */
export function visitTypesForMode(mode: IntakeInput['mode']): string[] {
  switch (mode) {
    case 'VIDEO':
    case 'WEB_AUDIO':
      return ['VIDEO']
    case 'PHONE':
      return ['PHONE']
    case 'EITHER':
      return ['VIDEO', 'PHONE']
  }
}
export function modeAllowedInJurisdiction(
  mode: IntakeInput['mode'],
  allowedVisitTypes: readonly string[]
): boolean {
  return visitTypesForMode(mode).some((candidate) => allowedVisitTypes.includes(candidate))
}
export function validateIntake(input: IntakeInput, questionnaire: Questionnaire) {
  // SMTP local parts can be case-sensitive; normalize the domain only.
  const email = input.email
    .trim()
    .replace(/@([^@]+)$/, (_, domain: string) => `@${domain.toLowerCase()}`)
  const phone = input.phone.replace(/[\s().-]/g, '')
  const emailValid = z.email().safeParse(email).success
  const phoneValid = /^\+[1-9]\d{7,14}$/.test(phone)
  const issues: string[] = []
  if (!input.firstName.trim() || !input.lastName.trim()) issues.push('NAME_REQUIRED')
  if (!emailValid) issues.push('EMAIL_REQUIRES_REVIEW')
  if (!phoneValid) issues.push('PHONE_REQUIRES_REVIEW')
  if (!input.reason.trim()) issues.push('REASON_REQUIRED')
  const knownIds = new Set(questionnaire.questions.map((q) => q.id))
  // ponytail: age gate lives outside the versioned questionnaire definition
  // (per-state copy), so allowlist it here instead of migrating definitions.
  knownIds.add('age_verified')
  for (const key of Object.keys(input.answers)) {
    if (!knownIds.has(key)) throw new UnknownAnswerKeyError(key)
  }
  const ageVerification = input.answers.age_verified
  if (ageVerification !== 'Yes' && ageVerification !== 'No')
    issues.push('AGE_VERIFICATION_REQUIRED')
  else if (ageVerification === 'No') issues.push('AGE_REQUIRES_REVIEW')
  for (const q of questionnaire.questions) {
    if (q.required && !input.answers[q.id]?.trim())
      issues.push(`ANSWER_${q.id.toUpperCase()}_REQUIRED`)
  }
  return {
    normalized: { email: emailValid ? email : null, phone: phoneValid ? phone : null },
    issues
  }
}

export type Timer = {
  status: 'READY' | 'ACTIVE' | 'PAUSED' | 'ENDED'
  duration: number
  elapsed: number
  runningSince: number | null
}
export function elapsedSeconds(timer: Timer, now: number) {
  return (
    timer.elapsed +
    (timer.runningSince === null ? 0 : Math.max(0, (now - timer.runningSince) / 1000))
  )
}
export function changeTimer(timer: Timer, action: string, seconds: number, now: number): Timer {
  const next = { ...timer }
  if (timer.status === 'ENDED') throw conflict()
  if (action === 'start' && timer.status === 'READY')
    return { ...next, status: 'ACTIVE', runningSince: now }
  if (action === 'pause' && timer.status === 'ACTIVE')
    return { ...next, status: 'PAUSED', elapsed: elapsedSeconds(timer, now), runningSince: null }
  if (action === 'resume' && timer.status === 'PAUSED')
    return { ...next, status: 'ACTIVE', runningSince: now }
  if (action === 'end' && ['ACTIVE', 'PAUSED'].includes(timer.status))
    return { ...next, status: 'ENDED', elapsed: elapsedSeconds(timer, now), runningSince: null }
  if (['extend', 'set'].includes(action)) {
    const duration = action === 'extend' ? timer.duration + seconds : seconds
    if (!Number.isInteger(duration) || seconds <= 0 || duration < 60 || duration > 14400)
      throw new Fault(400, 'DURATION_INVALID', 'Choose a duration between 1 minute and 4 hours.')
    return { ...next, duration }
  }
  throw conflict()
}
