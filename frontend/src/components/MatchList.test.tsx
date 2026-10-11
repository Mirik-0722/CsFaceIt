import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { MatchSummary } from '@/api/types'
import MatchList from './MatchList'

function match(overrides: Partial<MatchSummary> = {}): MatchSummary {
  return {
    matchId: 'm1',
    startedAt: '2026-10-01T10:00:00Z',
    finishedAt: '2026-10-01T10:45:00Z',
    result: 'WIN',
    score: { faction1: 13, faction2: 9 },
    ...overrides,
  }
}

function renderList(items: MatchSummary[]) {
  return render(<MatchList items={items} />, { wrapper: MemoryRouter })
}

describe('MatchList', () => {
  it('renders WIN badge and score', () => {
    renderList([match()])
    expect(screen.getByText('WIN')).toBeInTheDocument()
    expect(screen.getByText('13 : 9')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/matches/m1')
  })

  it('wraps date, badge and score of a row in one link, so its name carries the score', () => {
    renderList([match()])
    const link = screen.getByRole('link', { name: /13 : 9/ })
    expect(within(link).getByText('WIN')).toBeInTheDocument()
    expect(within(link).getByText('01 Oct 2026')).toBeInTheDocument()
  })

  it('formats the start date with a fixed locale', () => {
    renderList([match({ startedAt: '2026-01-05T23:30:00Z' })])
    expect(screen.getByText('05 Jan 2026')).toBeInTheDocument()
    expect(screen.getByText('05 Jan 2026')).toHaveAttribute('datetime', '2026-01-05T23:30:00Z')
  })

  it('colours WIN positive and LOSS negative', () => {
    renderList([match({ matchId: 'm1', result: 'WIN' }), match({ matchId: 'm2', result: 'LOSS' })])
    expect(screen.getByText('WIN').className).toContain('positive')
    expect(screen.getByText('LOSS').className).toContain('negative')
  })

  it('shows a neutral dash for an UNKNOWN result', () => {
    renderList([match({ result: 'UNKNOWN' })])
    const badge = screen.getByText('—')
    expect(badge.closest('[data-slot="badge"]')?.className).not.toMatch(/positive|negative/)
    expect(screen.queryByText('WIN')).not.toBeInTheDocument()
    expect(screen.queryByText('LOSS')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /result unknown/i })).toBeInTheDocument()
  })

  it.each([
    ['an empty score', {}],
    ['a score with one faction only', { faction1: 13 }],
  ])('renders a dash for %s instead of undefined', (_name, score) => {
    renderList([match({ score })])
    expect(screen.getByText('–')).toBeInTheDocument()
    expect(screen.getByRole('link').textContent).not.toContain('undefined')
  })

  it('renders a 0 score', () => {
    renderList([match({ score: { faction1: 0, faction2: 13 } })])
    expect(screen.getByText('0 : 13')).toBeInTheDocument()
  })

  it('renders one link per match, in the given order', () => {
    renderList([
      match({ matchId: 'm1', score: { faction1: 13, faction2: 9 } }),
      match({ matchId: 'm2', score: { faction1: 7, faction2: 13 }, result: 'LOSS' }),
    ])
    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/matches/m1', '/matches/m2'])
    expect(links[1]).toHaveTextContent('7 : 13')
  })

  it('says there are no matches for an empty list', () => {
    renderList([])
    expect(screen.getByText('No matches yet')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
