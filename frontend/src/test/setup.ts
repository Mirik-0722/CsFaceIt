import '@testing-library/jest-dom/vitest'

// Dates are rendered in the viewer's time zone; pin it so date assertions do not depend on the machine running them.
vi.stubEnv('TZ', 'UTC')

afterEach(() => {
  vi.unstubAllGlobals()
})
