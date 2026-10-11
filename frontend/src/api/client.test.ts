import { ApiError, apiGet } from './client'

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('apiGet', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds /api/v1 URL with query params and returns JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ nickname: 's1mple' }))))
    await expect(apiGet('/players', { nickname: 's1mple' })).resolves.toEqual({ nickname: 's1mple' })
    expect(fetch).toHaveBeenCalledWith('/api/v1/players?nickname=s1mple', expect.anything())
  })

  it('throws ApiError with code from body on non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'PLAYER_NOT_FOUND', message: 'x' }), { status: 404 })),
    )
    await expect(apiGet('/players', { nickname: 'nobody' })).rejects.toMatchObject({ status: 404, code: 'PLAYER_NOT_FOUND' })
  })

  it('omits the query string when there are no params', async () => {
    const fetchMock = stubFetch(new Response('{}'))
    await apiGet('/matches/abc')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/matches/abc', expect.anything())
  })

  it('sends numeric params as text', async () => {
    const fetchMock = stubFetch(new Response('{}'))
    await apiGet('/players/abc/history', { offset: 20, limit: 10 })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/players/abc/history?offset=20&limit=10', expect.anything())
  })

  it('URL-encodes query values', async () => {
    const fetchMock = stubFetch(new Response('{}'))
    await apiGet('/players', { nickname: 'a b&c=d/é' })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/players?nickname=a+b%26c%3Dd%2F%C3%A9', expect.anything())
  })

  it('URL-encodes path segments', async () => {
    const fetchMock = stubFetch(new Response('{}'))
    await apiGet('/players/a b?c#d%/history')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/players/a%20b%3Fc%23d%25/history', expect.anything())
  })

  it('does not let a dot segment climb out of the API prefix', async () => {
    const fetchMock = stubFetch(new Response('{}'))
    await apiGet('/players/../..')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/players/%2E%2E/%2E%2E', expect.anything())
  })

  it('asks for JSON', async () => {
    const fetchMock = stubFetch(new Response('{}'))
    await apiGet('/players/abc')
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), { headers: { Accept: 'application/json' } })
  })

  it('throws an ApiError instance carrying the message from the body', async () => {
    stubFetch(new Response(JSON.stringify({ code: 'VALIDATION_ERROR', message: 'nickname: invalid' }), { status: 400 }))
    const error = await apiGet('/players', { nickname: '!' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ name: 'ApiError', status: 400, code: 'VALIDATION_ERROR', message: 'nickname: invalid' })
  })

  it('uses code UNKNOWN when the error body is not JSON', async () => {
    stubFetch(new Response('<html>Bad Gateway</html>', { status: 502 }))
    const error = await apiGet('/players/abc').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 502, code: 'UNKNOWN', message: 'Request failed with status 502' })
  })

  it('uses code UNKNOWN when the error body is JSON of another shape', async () => {
    stubFetch(new Response(JSON.stringify({ error: 'boom' }), { status: 500 }))
    await expect(apiGet('/players/abc')).rejects.toMatchObject({
      status: 500,
      code: 'UNKNOWN',
      message: 'Request failed with status 500',
    })
  })

  it('throws ApiError NETWORK_ERROR with status 0 when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const error = await apiGet('/players/abc').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR', message: 'Failed to fetch' })
  })

  it('throws ApiError UNKNOWN when a successful response is not JSON', async () => {
    stubFetch(new Response('<!doctype html>', { status: 200 }))
    const error = await apiGet('/players/abc').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 200, code: 'UNKNOWN', message: 'Response is not valid JSON' })
  })
})
