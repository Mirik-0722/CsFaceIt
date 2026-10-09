import { render, screen } from '@testing-library/react'
import App from './App'

describe('App routing', () => {
  it.each([
    ['/', 'Search'],
    ['/players/abc-123', 'Player'],
    ['/matches/1-abc-123', 'Match'],
  ])('renders the placeholder page for %s', (path, heading) => {
    window.history.pushState({}, '', path)
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
  })
})
