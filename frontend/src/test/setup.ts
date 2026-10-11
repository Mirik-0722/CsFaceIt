import '@testing-library/jest-dom/vitest'

// The tests assert on the English copy, while the app itself starts in Uzbek. The i18n store reads this key when its
// module is first loaded, so it is set before anything imports it (and by its literal, not the exported constant,
// because importing that would load the module first).
localStorage.setItem('csfaceit.lang', 'en')

// Dates are rendered in the viewer's time zone; pin it so date assertions do not depend on the machine running them.
vi.stubEnv('TZ', 'UTC')

afterEach(() => {
  vi.unstubAllGlobals()
})
