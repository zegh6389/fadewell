import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import test from 'node:test'
import { recipientHash } from '../src/delivery.ts'

// CodeRabbit flagged the original recipientHash: SHA-256 of `"channel:recipient"`
// has no key, so anyone with read access to the notifications table can
// enumerate emails and phone numbers (small input spaces — common providers,
// 10-digit phone numbers, public breach corpuses) and recover the recipient
// from `last_recipient_hash`. The fix is a keyed, domain-separated HMAC.
// These tests pin the security contract: keyed (different key => different
// output), domain-separated (channel matters), deterministic (same input =>
// same output), and resistant to raw-SHA-256 enumeration.

const KEY_A = randomBytes(32).toString('base64')
const KEY_B = randomBytes(32).toString('base64')

test('recipientHash returns a 64-char hex string (preserves the existing column format)', () => {
  const h = recipientHash('EMAIL', 'patient@example.test', KEY_A)
  assert.equal(h.length, 64)
  assert.match(h, /^[0-9a-f]{64}$/)
})

test('recipientHash is deterministic for the same key and input (durable dedupe index)', () => {
  const a = recipientHash('EMAIL', 'patient@example.test', KEY_A)
  const b = recipientHash('EMAIL', 'patient@example.test', KEY_A)
  assert.equal(a, b)
})

test('recipientHash distinguishes channels so EMAIL and SMS hashes never collide', () => {
  const email = recipientHash('EMAIL', '+12025550199', KEY_A)
  const sms = recipientHash('SMS', '+12025550199', KEY_A)
  assert.notEqual(email, sms)
})

test('recipientHash distinguishes recipients so two different patients never collide', () => {
  const a = recipientHash('EMAIL', 'alice@example.test', KEY_A)
  const b = recipientHash('EMAIL', 'bob@example.test', KEY_A)
  assert.notEqual(a, b)
})

test('recipientHash with a different encryption key produces a different hash (the security property)', () => {
  const sameChannel = 'EMAIL'
  const sameRecipient = 'patient@example.test'
  const fromA = recipientHash(sameChannel, sameRecipient, KEY_A)
  const fromB = recipientHash(sameChannel, sameRecipient, KEY_B)
  assert.notEqual(
    fromA,
    fromB,
    'a different encryption key must produce a different recipient hash — without this property the table is enumerable'
  )
})

test('recipientHash output does not equal raw SHA-256(channel:recipient) — proves it is keyed, not raw', () => {
  const channel = 'EMAIL'
  const recipient = 'patient@example.test'
  const raw = createHash('sha256').update(`${channel}:${recipient}`).digest('hex')
  const keyed = recipientHash(channel, recipient, KEY_A)
  assert.notEqual(
    keyed,
    raw,
    'recipientHash must NOT equal raw SHA-256 or an attacker can precompute a rainbow table and recover recipients from the column'
  )
})
