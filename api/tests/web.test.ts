import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'

test('same-origin hosting serves private deep links and preserves API errors and no-store headers', async (t) => {
  const app = await buildApp(loadConfig({}), undefined, () => {}, fileURLToPath(new URL('./web-fixture/', import.meta.url)))
  t.after(() => app.close())
  for (const path of ['/', '/patient', '/admin', '/portal', '/staff']) {
    const page = await app.inject(path)
    assert.equal(page.statusCode, 200)
    assert.match(page.headers['content-type'] as string, /text\/html/)
    assert.equal(page.headers['cache-control'], 'no-store')
    assert.equal(
      page.headers['x-robots-tag'],
      path === '/' ? undefined : 'noindex, nofollow'
    )
    assert.match(page.headers['content-security-policy'] as string, /script-src 'self'/)
    assert.match(page.headers['content-security-policy'] as string, /wss:\/\/video\.telnyx\.com/)
    assert.equal(
      page.headers['permissions-policy'],
      ['/patient', '/portal'].includes(path)
        ? 'camera=(self), microphone=(self), geolocation=()'
        : 'camera=(), microphone=(), geolocation=()'
    )
  }
  for (const path of ['/api/missing', '/missing.js', '/.env', '/%2e%2e/package.json'])
    assert.equal((await app.inject(path)).statusCode, 404)
  assert.equal((await app.inject('/api/health/ready')).statusCode, 503)
})

test('production pages redirect to the cookie origin but origin health probes remain reachable', async (t) => {
  const app = await buildApp({ ...loadConfig({}), production: true, origin: 'https://care.example.test' }, undefined, () => {}, fileURLToPath(new URL('./web-fixture/', import.meta.url)))
  t.after(() => app.close())
  const page = await app.inject({ url: '/patient?view=intake', headers: { host: 'www.care.example.test' } })
  assert.equal(page.statusCode, 308)
  assert.equal(page.headers.location, 'https://care.example.test/patient?view=intake')
  assert.equal((await app.inject('/api/health/live')).statusCode, 200)
})
