import { render, screen } from '@testing-library/react'
import type { PlayerResponse } from '@/api/types'
import PlayerHeader from './PlayerHeader'

const player: PlayerResponse = {
  playerId: 'p1',
  nickname: 's1mple',
  elo: 3500,
  level: 10,
  avatar: 'https://cdn.example/s1mple.jpg',
  country: 'UA',
}

describe('PlayerHeader', () => {
  it('shows nickname, country, ELO and level', () => {
    render(<PlayerHeader player={player} />)
    expect(screen.getByText('s1mple')).toBeInTheDocument()
    expect(screen.getByText('UA')).toBeInTheDocument()
    expect(screen.getByText('ELO 3,500')).toBeInTheDocument()
    expect(screen.getByText('Level 10')).toBeInTheDocument()
    expect(screen.queryByText('No CS2 data')).not.toBeInTheDocument()
  })

  it('shows the avatar image when there is one', () => {
    const { container } = render(<PlayerHeader player={player} />)
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.example/s1mple.jpg')
  })

  it.each([
    ['null', null],
    ['empty', ''],
  ])('falls back to the nickname initial when the avatar is %s', (_name, avatar) => {
    const { container } = render(<PlayerHeader player={{ ...player, nickname: 'nobody', avatar }} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('N')).toBeInTheDocument()
  })

  it('shows "No CS2 data" instead of ELO and level when both are null', () => {
    render(<PlayerHeader player={{ ...player, elo: null, level: null }} />)
    expect(screen.getByText('No CS2 data')).toBeInTheDocument()
    expect(screen.queryByText(/ELO/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Level/)).not.toBeInTheDocument()
    expect(screen.queryByText(/null|undefined/)).not.toBeInTheDocument()
  })

  it('omits the country when it is null', () => {
    render(<PlayerHeader player={{ ...player, country: null }} />)
    expect(screen.queryByText('UA')).not.toBeInTheDocument()
    expect(screen.getByText('s1mple')).toBeInTheDocument()
  })

  it('shows only the value that is present when just one of ELO and level is null', () => {
    render(<PlayerHeader player={{ ...player, level: null }} />)
    expect(screen.getByText('ELO 3,500')).toBeInTheDocument()
    expect(screen.queryByText(/Level/)).not.toBeInTheDocument()
    expect(screen.queryByText('No CS2 data')).not.toBeInTheDocument()
  })

  it('shows 0 rather than treating it as missing', () => {
    render(<PlayerHeader player={{ ...player, elo: 0, level: 0 }} />)
    expect(screen.getByText('ELO 0')).toBeInTheDocument()
    expect(screen.getByText('Level 0')).toBeInTheDocument()
  })
})
