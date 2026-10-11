import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PlayerResponse } from '@/api/types'
import { deferred, mockFetchOnce, mockFetchRoutes, renderWithProviders, type MockReply } from '@/test/utils'
import SearchPage from './SearchPage'

const s1mple: PlayerResponse = {
  playerId: 'p1',
  nickname: 's1mple',
  elo: 3500,
  level: 10,
  avatar: '',
  country: 'UA',
}

const INVALID_NICKNAME_MESSAGE = 'Nickname must be 2–32 characters: letters, digits, _ or -'

async function search(nickname: string) {
  await userEvent.type(screen.getByLabelText('nickname'), nickname)
  await userEvent.click(screen.getByRole('button', { name: /search/i }))
}

describe('SearchPage', () => {
  it('shows player card after searching', async () => {
    mockFetchOnce(s1mple)
    renderWithProviders(<SearchPage />)
    await search('s1mple')
    expect(await screen.findByText('s1mple')).toBeInTheDocument()
    expect(screen.getByText(/ELO 3500/)).toBeInTheDocument()
  })

  it('wraps the result card in one link to the player profile', async () => {
    mockFetchOnce(s1mple)
    renderWithProviders(<SearchPage />)
    await search('s1mple')
    const link = await screen.findByRole('link', { name: /s1mple/ })
    expect(link).toHaveAttribute('href', '/players/p1')
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('has a labelled nickname input with the placeholder from the brief', () => {
    renderWithProviders(<SearchPage />)
    expect(screen.getByLabelText('nickname')).toHaveAttribute('placeholder', 'FACEIT nickname')
  })

  it('searches when Enter is pressed in the input', async () => {
    const fetchMock = mockFetchOnce(s1mple)
    renderWithProviders(<SearchPage />)
    await userEvent.type(screen.getByLabelText('nickname'), 's1mple{Enter}')
    expect(await screen.findByText(/ELO 3500/)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/players?nickname=s1mple', expect.anything())
  })

  it('trims the nickname before searching', async () => {
    const fetchMock = mockFetchOnce(s1mple)
    renderWithProviders(<SearchPage />)
    await search('  s1mple ')
    expect(await screen.findByText('s1mple')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/players?nickname=s1mple', expect.anything())
  })

  it('announces the loading state and then the result in a polite live region', async () => {
    const answer = deferred<MockReply>()
    mockFetchRoutes({ '/api/v1/players?nickname=s1mple': () => answer.promise })
    renderWithProviders(<SearchPage />)
    await search('s1mple')

    const loading = await screen.findByText('Searching…')
    expect(loading.closest('[aria-live="polite"]')).not.toBeNull()

    answer.resolve({ body: s1mple })
    const nickname = await screen.findByText('s1mple')
    expect(nickname.closest('[aria-live="polite"]')).not.toBeNull()
    expect(screen.queryByText('Searching…')).not.toBeInTheDocument()
  })

  describe('nickname validation', () => {
    it.each([
      ['a single character', 'a'],
      ['a space', 'bad name'],
      ['a symbol', 'bad!name'],
      ['a non-ASCII letter', 'sïmple'],
      ['more than 32 characters', 'x'.repeat(33)],
    ])('rejects %s without calling the API', async (_name, nickname) => {
      const fetchMock = mockFetchOnce(s1mple)
      renderWithProviders(<SearchPage />)
      await search(nickname)

      const message = screen.getByText(INVALID_NICKNAME_MESSAGE)
      expect(message.closest('[aria-live="polite"]')).not.toBeNull()
      expect(screen.getByLabelText('nickname')).toBeInvalid()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it.each(['ab', 'a_b-C9', 'x'.repeat(32)])('accepts %s', async (nickname) => {
      const fetchMock = mockFetchOnce({ ...s1mple, nickname })
      renderWithProviders(<SearchPage />)
      await search(nickname)

      expect(await screen.findByText(nickname)).toBeInTheDocument()
      expect(screen.queryByText(INVALID_NICKNAME_MESSAGE)).not.toBeInTheDocument()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('replaces an earlier result with the message when the next nickname is invalid', async () => {
      mockFetchOnce(s1mple)
      renderWithProviders(<SearchPage />)
      await search('s1mple')
      expect(await screen.findByText('s1mple')).toBeInTheDocument()

      await userEvent.clear(screen.getByLabelText('nickname'))
      await search('!')

      expect(screen.getByText(INVALID_NICKNAME_MESSAGE)).toBeInTheDocument()
      expect(screen.queryByText('s1mple')).not.toBeInTheDocument()
    })

    it('clears the message once a valid nickname is submitted', async () => {
      mockFetchOnce(s1mple)
      renderWithProviders(<SearchPage />)
      await search('!')
      expect(screen.getByText(INVALID_NICKNAME_MESSAGE)).toBeInTheDocument()

      await userEvent.clear(screen.getByLabelText('nickname'))
      await search('s1mple')

      expect(await screen.findByText('s1mple')).toBeInTheDocument()
      expect(screen.queryByText(INVALID_NICKNAME_MESSAGE)).not.toBeInTheDocument()
      expect(screen.getByLabelText('nickname')).toBeValid()
    })
  })

  describe('errors', () => {
    it('shows not-found message on 404', async () => {
      mockFetchOnce({ code: 'PLAYER_NOT_FOUND', message: 'Player nobody not found' }, 404)
      renderWithProviders(<SearchPage />)
      await search('nobody')
      const message = await screen.findByText('Player not found')
      expect(message.closest('[aria-live="polite"]')).not.toBeNull()
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })

    it('says FACEIT is unavailable on 502', async () => {
      mockFetchRoutes({
        '/api/v1/players?nickname=s1mple': { body: { code: 'FACEIT_UNAVAILABLE', message: 'x' }, status: 502 },
      })
      renderWithProviders(<SearchPage />)
      await search('s1mple')
      expect(await screen.findByText('FACEIT is temporarily unavailable. Try again later.')).toBeInTheDocument()
    })

    it('shows a generic message for any other error', async () => {
      mockFetchRoutes({
        '/api/v1/players?nickname=s1mple': { body: { code: 'INTERNAL_ERROR', message: 'x' }, status: 500 },
      })
      renderWithProviders(<SearchPage />)
      await search('s1mple')
      expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument()
    })

    it('searches again when the same nickname is submitted after a failure', async () => {
      let available = false
      mockFetchRoutes({
        '/api/v1/players?nickname=s1mple': async () =>
          available ? { body: s1mple } : { body: { code: 'FACEIT_UNAVAILABLE', message: 'x' }, status: 502 },
      })
      renderWithProviders(<SearchPage />)
      await search('s1mple')
      expect(await screen.findByText('FACEIT is temporarily unavailable. Try again later.')).toBeInTheDocument()

      available = true
      await userEvent.click(screen.getByRole('button', { name: /search/i }))

      expect(await screen.findByText('s1mple')).toBeInTheDocument()
      expect(screen.queryByText('FACEIT is temporarily unavailable. Try again later.')).not.toBeInTheDocument()
    })
  })

  it('shows a player without CS2 data', async () => {
    mockFetchOnce({ ...s1mple, elo: null, level: null, avatar: null, country: null })
    renderWithProviders(<SearchPage />)
    await search('s1mple')
    expect(await screen.findByText('No CS2 data')).toBeInTheDocument()
    expect(screen.queryByText(/ELO/)).not.toBeInTheDocument()
  })
})
