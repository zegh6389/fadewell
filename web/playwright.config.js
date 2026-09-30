import { defineConfig, devices } from '@playwright/test'

/**
 * MmjGreen browser tests.
 *
 * The suite starts two isolated servers itself:
 *   - the synthetic in-memory API from ../api/tests/browser-server.ts (port 3001)
 *   - the production bundle via `vite preview` (port 4173), which proxies /api
 *
 * Both are refused if NODE_ENV is production or a real database URL is set, so
 * these tests can never touch live patient data.
 */
export default defineConfig({
  testDir: './tests/browser',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] }
    }
  ],

  webServer: [
    {
      // APP_ORIGIN must match the origin the browser uses, or every mutating
      // request is rejected as cross-origin. `vite preview` serves on 4173.
      command: 'node --experimental-strip-types ../api/tests/browser-server.ts',
      env: {
        APP_ORIGIN: 'http://127.0.0.1:4173',
        NODE_ENV: 'test'
      },
      url: 'http://127.0.0.1:3001/api/health/live',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe'
    },
    {
      // --host is required: without it Vite binds localhost, which resolves to
      // ::1 only on this platform and Playwright's 127.0.0.1 probe never sees it.
      command: 'npm run build && npx vite preview --port 4173 --strictPort --host 127.0.0.1',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe'
    }
  ]
})
