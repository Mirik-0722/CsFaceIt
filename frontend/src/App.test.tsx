import { render, screen } from '@testing-library/react'
import App from './App'

describe('App routing', () => {
  beforeEach(() => {
    // The pages fetch on mount; an answer that never arrives keeps these tests about routing only.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
  })

  it('renders the search page for /', () => {
    window.history.pushState({}, '', '/')
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'Every ace deserves a clip.' })).toBeInTheDocument()
    expect(screen.getByLabelText('nickname')).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('renders the player page for /players/:playerId and passes the id on', () => {
    window.history.pushState({}, '', '/players/abc-123')
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'Player profile' })).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/v1/players/abc-123', expect.anything())
    expect(fetch).toHaveBeenCalledWith('/api/v1/players/abc-123/history?offset=0&limit=20', expect.anything())
  })

  it('renders the match page for /matches/:matchId and passes the id on', () => {
    window.history.pushState({}, '', '/matches/1-abc-123')
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'Match' })).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/v1/matches/1-abc-123', expect.anything())
    expect(fetch).toHaveBeenCalledWith('/api/v1/matches/1-abc-123/stats', expect.anything())
  })
})
