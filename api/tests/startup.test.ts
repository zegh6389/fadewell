import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

test('operator CLI startup failures do not print credential-bearing configuration', () => {
  const marker = 'synthetic-secret-marker'
  for (const [script, args] of [
    ['migrate.ts', []],
    ['provision.ts', ['ADMIN']],
    ['server.ts', []],
    ['worker.ts', []]
  ] as const) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL(`../src/${script}`, import.meta.url)), ...args],
      {
        encoding: 'utf8',
        timeout: 15000,
        env: {
          ...process.env,
          NODE_ENV: 'development',
          NODE_TLS_REJECT_UNAUTHORIZED: '1',
          APP_ORIGIN: 'http://localhost:5173',
          NOTIFICATIONS_ENABLED: 'false',
          OIDC_ISSUER: 'https://identity.example.test',
          DATA_ENCRYPTION_KEY: '',
          PROVISION_SUBJECT: 'synthetic-subject',
          DATABASE_URL: `postgres://operator:${marker}@invalid host/db`
        }
      }
    )
    assert.equal(result.status, 1, script)
    assert.equal(`${result.stdout}${result.stderr}`.includes(marker), false, script)
  }
})
