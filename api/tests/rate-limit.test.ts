import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'

test('rate limiting is keyed by client IP, not shared across clients', async (t) => {
  const app = await buildApp(
    { ...loadConfig({}), origin: 'https://care.example.test' },
    undefined,
    () => {}
  )
  t.after(() => app.close())
  const headers = { 'x-forwarded-for': '203.0.113.7' }
  for (let i = 0; i < 120; i += 1) {
    const response = await app.inject({ url: '/api/auth/status', headers })
    assert.equal(response.statusCode, 200)
  }
  const limited = await app.inject({ url: '/api/auth/status', headers })
  assert.equal(limited.statusCode, 429)
  const other = await app.inject({
    url: '/api/auth/status',
    headers: { 'x-forwarded-for': '198.51.100.9' }
  })
  assert.equal(other.statusCode, 200)
})
