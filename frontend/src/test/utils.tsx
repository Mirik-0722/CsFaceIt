import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

interface RenderOptions {
  /** The URL the router starts at. */
  route?: string
  /** The route pattern `ui` is mounted on; `/players/:playerId` gives a page its URL params. */
  path?: string
}

/** Renders `ui` inside a fresh QueryClient and a MemoryRouter, so every test starts with an empty cache. */
export function renderWithProviders(ui: ReactElement, { route = '/', path = '*' }: RenderOptions = {}) {
  // `retry: false` is a default that the query hooks override with their own policy (one retry for a non-4xx
  // failure), so `retryDelay: 0` keeps that single retry instant instead of waiting a second.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={path} element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** A canned answer: the JSON `body` and the HTTP `status` (200 unless given). A 204 has no body, whatever `body` is. */
export interface MockReply {
  body: unknown
  status?: number
}

function toResponse({ body, status = 200 }: MockReply): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status })
}

/**
 * Makes the next `fetch` answer with `body`; a second call is an unexpected request and fails loudly. The stub
 * replaces any earlier one and is removed after each test. Returns the mock, so a test can assert on the URLs.
 */
export function mockFetchOnce(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValueOnce(toResponse({ body, status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/**
 * Makes `fetch` answer by exact request URL (path and query), as often as it is asked: a retried request gets the
 * same answer again. A route may be a function, to answer later or to answer differently over time. Any other URL
 * rejects, which the API client reports as a network error.
 */
export function mockFetchRoutes(routes: Record<string, MockReply | (() => Promise<MockReply>)>) {
  const fetchMock = vi.fn(async (url: string) => {
    const reply = routes[url]
    if (reply === undefined) {
      throw new Error(`Unexpected request to ${url}`)
    }
    return toResponse(typeof reply === 'function' ? await reply() : reply)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** A promise that is settled from outside, to hold a response back until the test lets it through. */
export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}
