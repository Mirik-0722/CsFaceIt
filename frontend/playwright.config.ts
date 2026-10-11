import { defineConfig, devices } from '@playwright/test'

// The API is mocked at the network layer (see e2e/search-flow.spec.ts), so only the Vite dev server has to run.
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // `list` for the terminal; the HTML report is written to playwright-report/ but never opened (it would block a run).
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    // The flows assert on the English copy, while the app itself starts in Uzbek: every context begins with the
    // language key (src/i18n LOCALE_STORAGE_KEY) set to `en`.
    storageState: {
      cookies: [],
      origins: [
        { origin: 'http://localhost:5173', localStorage: [{ name: 'csfaceit.lang', value: 'en' }] },
      ],
    },
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
})
