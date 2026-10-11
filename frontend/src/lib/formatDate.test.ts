import { formatDate } from './formatDate'

describe('formatDate', () => {
  it('formats an ISO instant as day, short month and year in a fixed locale', () => {
    expect(formatDate('2026-10-01T10:00:00Z')).toBe('01 Oct 2026')
    expect(formatDate('2026-01-05T12:30:00Z')).toBe('05 Jan 2026')
  })
})
