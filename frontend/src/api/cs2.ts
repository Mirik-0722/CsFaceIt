import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { ApiError, apiDelete, apiGet, apiPost } from './client'
import type { Cs2LinkRequest, Cs2LinkResponse } from './cs2Types'
import { retryUnlessClientError } from './queries'

export type { Cs2LinkRequest, Cs2LinkResponse, Cs2LinkState } from './cs2Types'

/**
 * Where the visitor's CS2 link stands: the feature is off on the server (`disabled`: the page shows nothing of it), the
 * visitor has no link (`unlinked`), or the link and its state.
 */
export type Cs2Link = { kind: 'disabled' } | { kind: 'unlinked' } | { kind: 'linked'; link: Cs2LinkResponse }

/** The code of every answer of `/cs2/link` while the feature is off on the server (no Steam key, no bridge, no secret). */
const CS2_DISABLED = 'CS2_DISABLED'

/** The link is the signed-in user's: one cache entry per user, so that a second account in the tab never sees the first's. */
function cs2LinkKey(userId: number) {
  return ['cs2-link', userId] as const
}

/** What a 404 of `/cs2/link` says: the feature is off, or the visitor has no link (any other code). */
function fromNotFound(error: ApiError): Cs2Link {
  return error.code === CS2_DISABLED ? { kind: 'disabled' } : { kind: 'unlinked' }
}

/**
 * The signed-in visitor's CS2 link (`GET /cs2/link`); asked for only while `userId` is a user's (the section is on the
 * visitor's own page only). A 404 is a state, not an error: see {@link Cs2Link}.
 */
export function useCs2Link(userId: number | null) {
  return useQuery<Cs2Link, ApiError>({
    queryKey: cs2LinkKey(userId ?? 0),
    queryFn: async () => {
      try {
        return { kind: 'linked', link: await apiGet<Cs2LinkResponse>('/cs2/link') }
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          return fromNotFound(error)
        }
        throw error
      }
    },
    enabled: userId !== null,
    retry: retryUnlessClientError,
  })
}

/**
 * The two writes of the link, as the signed-in visitor (the session; never the admin key). They are plain functions and
 * not mutations on purpose: a mutation keeps its variables in the query client, and the authentication code is a secret
 * that nothing on the page may keep once it is sent. Each answer goes straight into the link's cache entry (the visitor
 * of `/auth/me` does not change with the link, so it is not asked for again); each failure is thrown to the caller as
 * the {@link ApiError} it is, after a refusal that says the feature is off has put the entry in that state.
 */
export function useCs2LinkWrites(userId: number) {
  const queryClient = useQueryClient()
  const put = useCallback(
    (link: Cs2Link) => queryClient.setQueryData<Cs2Link>(cs2LinkKey(userId), link),
    [queryClient, userId],
  )
  const fail = useCallback(
    (error: unknown): never => {
      if (error instanceof ApiError && error.code === CS2_DISABLED) {
        put({ kind: 'disabled' })
      }
      throw error
    },
    [put],
  )

  /** Links the visitor's matchmaking games (201 a new link, 200 a renewed one); the answer is the link as it is now. */
  const link = useCallback(
    async (request: Cs2LinkRequest): Promise<void> => {
      try {
        put({ kind: 'linked', link: await apiPost<Cs2LinkResponse>('/cs2/link', { body: request }) })
      } catch (error) {
        // Any 2xx is a link that exists, also one whose body cannot be read: the state is then asked for again.
        if (error instanceof ApiError && error.status >= 200 && error.status < 300) {
          void queryClient.invalidateQueries({ queryKey: cs2LinkKey(userId) })
          return
        }
        fail(error)
      }
    },
    [put, fail, queryClient, userId],
  )

  /** Removes the link (204); a link that is already gone (404) is the same outcome. The matches it brought stay. */
  const unlink = useCallback(async (): Promise<void> => {
    try {
      await apiDelete('/cs2/link')
      put({ kind: 'unlinked' })
    } catch (error) {
      if (error instanceof ApiError && error.status === 404 && error.code !== CS2_DISABLED) {
        put({ kind: 'unlinked' })
        return
      }
      fail(error)
    }
  }, [put, fail])

  return { link, unlink }
}
