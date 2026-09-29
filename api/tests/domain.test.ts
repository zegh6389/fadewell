import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

test('encrypted records reject tampering and cross-record substitution', async () => {
  const { seal, open } = await import('../src/security.ts')
  const key = randomBytes(32).toString('base64')
  const encrypted = seal({ reason: 'sensitive test value' }, key, 'intake:one')
  assert.ok(!encrypted.includes('sensitive'))
  assert.deepEqual(open(encrypted, key, 'intake:one'), { reason: 'sensitive test value' })
  assert.throws(() => open(encrypted, key, 'intake:two'))
  assert.throws(() => open(encrypted, randomBytes(32).toString('base64'), 'intake:one'))
  assert.throws(() => open(`${encrypted.slice(0, -4)}AAAA`, key, 'intake:one'))
})

test('questionable bounded contact values are preserved and flagged', async () => {
  const { validateIntake, intakeInput, questionnaire } = await import('../src/domain.ts')
  const raw = {
    firstName: 'Mira',
    lastName: 'Test',
    email: 'broken',
    phone: '123',
    state: 'CA',
    reason: 'Care',
    mode: 'VIDEO',
    smsConsent: false,
    emailConsent: false,
    answers: {}
  }
  const result = validateIntake(intakeInput.parse({ version: 0, ...raw }), questionnaire)
  assert.ok(result.issues.includes('EMAIL_REQUIRES_REVIEW'))
  assert.ok(result.issues.includes('PHONE_REQUIRES_REVIEW'))
  assert.equal(result.normalized.email, null)
  assert.equal(raw.email, 'broken')
  assert.throws(() => intakeInput.parse({ version: 0, ...raw, role: 'ADMIN' }))
  assert.throws(() => intakeInput.parse({ version: 0, ...raw, reason: 'x'.repeat(4001) }))
})

test('timer pause/resume preserves elapsed time and zero never ends care', async () => {
  const { changeTimer } = await import('../src/domain.ts')
  let timer = {
    status: 'READY',
    duration: 900,
    elapsed: 0,
    runningSince: null
  } as import('../src/domain.ts').Timer
  timer = changeTimer(timer, 'start', 0, 1000)
  timer = changeTimer(timer, 'pause', 0, 61000)
  timer = changeTimer(timer, 'resume', 0, 100000)
  assert.equal(timer.status, 'ACTIVE')
  timer = changeTimer(timer, 'extend', 300, 1000000)
  assert.throws(() => changeTimer(timer, 'start', 0, 1000000))
  timer = changeTimer(timer, 'end', 0, 1000000)
  assert.equal(timer.status, 'ENDED')
  assert.throws(() => changeTimer(timer, 'resume', 0, 1000000))
})

test('email normalization preserves case-sensitive local parts', async () => {
  const { validateIntake, intakeInput, questionnaire } = await import('../src/domain.ts')
  const input = intakeInput.parse({
    version: 0,
    firstName: 'Synthetic',
    lastName: 'Patient',
    email: 'CaseSensitive@EXAMPLE.TEST',
    phone: '+12025550138',
    state: 'CA',
    reason: 'Review',
    mode: 'VIDEO',
    emailConsent: true,
    smsConsent: false,
    answers: {}
  })
  assert.equal(validateIntake(input, questionnaire).normalized.email, 'CaseSensitive@example.test')
})

test('age verification accepts only Yes or No and flags No for review', async () => {
  const { validateIntake, intakeInput, questionnaire } = await import('../src/domain.ts')
  const raw = {
    version: 0,
    firstName: 'Synthetic',
    lastName: 'Patient',
    email: 'synthetic@example.test',
    phone: '+12025550138',
    state: 'CA',
    reason: 'Review',
    mode: 'VIDEO',
    emailConsent: false,
    smsConsent: false
  } as const
  const issuesFor = (age_verified?: string) =>
    validateIntake(intakeInput.parse({ ...raw, answers: age_verified === undefined ? {} : { age_verified } }), questionnaire).issues
  assert.ok(issuesFor().includes('AGE_VERIFICATION_REQUIRED'))
  assert.ok(issuesFor('Maybe').includes('AGE_VERIFICATION_REQUIRED'))
  assert.equal(issuesFor('Yes').includes('AGE_VERIFICATION_REQUIRED'), false)
  assert.ok(issuesFor('No').includes('AGE_REQUIRES_REVIEW'))
})

test('prescription refills remain fixed at zero until refill accounting is implemented', async () => {
  const { prescriptionInput } = await import('../src/domain.ts')
  assert.equal(prescriptionInput.parse({ amountOz: 1 }).refillsRemaining, 0)
  assert.equal(prescriptionInput.safeParse({ amountOz: 1, refillsRemaining: 1 }).success, false)
})
