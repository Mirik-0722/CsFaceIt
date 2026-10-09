import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { PlayerStatsResponse, TeamStatsResponse } from '@/api/types'
import StatsTable from './StatsTable'

function player(overrides: Partial<PlayerStatsResponse> = {}): PlayerStatsResponse {
  return {
    playerId: 'p1',
    nickname: 's1mple',
    kills: 25,
    deaths: 14,
    assists: 5,
    headshots: 12,
    kdRatio: 1.7857,
    krRatio: 0.92,
    adr: 95.43,
    ...overrides,
  }
}

function team(overrides: Partial<TeamStatsResponse> = {}): TeamStatsResponse {
  return { teamId: 't1', name: 'Natus Vincere', score: 13, win: true, players: [player()], ...overrides }
}

function renderTable(value: TeamStatsResponse) {
  return render(<StatsTable team={value} />, { wrapper: MemoryRouter })
}

/** The text of each body row's cells, one array per row. */
function bodyRows(): string[][] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent ?? ''))
}

describe('StatsTable', () => {
  it('renders header columns and player row', () => {
    renderTable(team())
    expect(screen.getByRole('columnheader', { name: 'K/D' })).toBeInTheDocument()
    const row = screen.getByRole('row', { name: /s1mple/ })
    expect(row).toHaveTextContent('25')
    expect(row).toHaveTextContent('14')
    expect(row).toHaveTextContent('95.4')
    expect(screen.getByText('Winner')).toBeInTheDocument()
  })

  it('has exactly the columns Player, K, D, A, HS, K/D, ADR, in that order', () => {
    renderTable(team())
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Player',
      'K',
      'D',
      'A',
      'HS',
      'K/D',
      'ADR',
    ])
  })

  it('puts the player, counts, K/D with two decimals and ADR with one decimal in the matching columns', () => {
    renderTable(team())
    expect(bodyRows()).toEqual([['s1mple', '25', '14', '5', '12', '1.79', '95.4']])
  })

  it('pads K/D and ADR to a fixed number of decimals', () => {
    renderTable(team({ players: [player({ kdRatio: 2, adr: 100 }), player({ playerId: 'p2', kdRatio: 0, adr: 0 })] }))
    expect(bodyRows().map((cells) => cells.slice(5))).toEqual([
      ['2.00', '100.0'],
      ['0.00', '0.0'],
    ])
  })

  it('shows the team name and its score in the table header', () => {
    renderTable(team({ name: 'Natus Vincere', score: 13 }))
    const table = screen.getByRole('table', { name: /Natus Vincere/ })
    expect(within(table).getByRole('heading', { name: 'Natus Vincere' })).toBeInTheDocument()
    expect(within(table).getByText('13')).toBeInTheDocument()
  })

  it('shows a 0 score', () => {
    renderTable(team({ score: 0, win: false }))
    expect(screen.getByRole('table', { name: /Score: 0$/ })).toBeInTheDocument()
  })

  it('shows the Winner badge only for the winning team', () => {
    const { rerender } = renderTable(team({ win: true }))
    expect(screen.getByText('Winner')).toBeInTheDocument()
    rerender(<StatsTable team={team({ win: false })} />)
    expect(screen.queryByText('Winner')).not.toBeInTheDocument()
  })

  it('calls a team without a name "Team"', () => {
    renderTable(team({ name: null }))
    expect(screen.getByRole('heading', { name: 'Team' })).toBeInTheDocument()
  })

  it('links each player name to the player page', () => {
    renderTable(team({ players: [player(), player({ playerId: 'p2', nickname: 'ZywOo' })] }))
    expect(screen.getByRole('link', { name: 's1mple' })).toHaveAttribute('href', '/players/p1')
    expect(screen.getByRole('link', { name: 'ZywOo' })).toHaveAttribute('href', '/players/p2')
  })

  it('encodes the player id in the link', () => {
    renderTable(team({ players: [player({ playerId: 'a b/c' })] }))
    expect(screen.getByRole('link', { name: 's1mple' })).toHaveAttribute('href', '/players/a%20b%2Fc')
  })

  it('sorts the rows by kills, highest first', () => {
    renderTable(
      team({
        players: [
          player({ playerId: 'p1', nickname: 'low', kills: 8 }),
          player({ playerId: 'p2', nickname: 'high', kills: 31 }),
          player({ playerId: 'p3', nickname: 'mid', kills: 17 }),
        ],
      }),
    )
    expect(bodyRows().map((cells) => cells[0])).toEqual(['high', 'mid', 'low'])
  })

  it('keeps the API order of players with equal kills', () => {
    renderTable(
      team({
        players: [
          player({ playerId: 'p1', nickname: 'first', kills: 10 }),
          player({ playerId: 'p2', nickname: 'top', kills: 20 }),
          player({ playerId: 'p3', nickname: 'second', kills: 10 }),
          player({ playerId: 'p4', nickname: 'third', kills: 10 }),
        ],
      }),
    )
    expect(bodyRows().map((cells) => cells[0])).toEqual(['top', 'first', 'second', 'third'])
  })

  it('does not reorder the players it was given', () => {
    const players = [player({ playerId: 'p1', nickname: 'low', kills: 1 }), player({ playerId: 'p2', nickname: 'high', kills: 9 })]
    renderTable(team({ players }))
    expect(players.map((p) => p.nickname)).toEqual(['low', 'high'])
  })

  it('renders the header and a "No player stats" row for an empty roster', () => {
    renderTable(team({ players: [] }))
    expect(screen.getAllByRole('columnheader')).toHaveLength(7)
    expect(screen.getByRole('heading', { name: 'Natus Vincere' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'No player stats' })).toHaveAttribute('colspan', '7')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(2)
  })
})
