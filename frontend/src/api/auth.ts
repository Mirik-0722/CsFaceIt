import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AuthProvider, AuthProvidersResponse, MeResponse } from './authTypes'
import { ApiError, apiGet, apiGetOrNull } from './client'

export type { AuthProvider, AuthProvidersResponse, MeResponse, UserRole } from './authTypes'

const ME_KEY = ['auth', 'me'] as const

/**
 * Who is signed in: the visitor, or `null` for one who is not (the backend answers 204 No Content, which is a state of
 * the page and not an error, and which leaves no failed request in the browser's console). It is not retried, so the
 * page knows within one round trip which way to draw itself; a failure of any kind leaves `data` undefined and the
 * page draws itself as for a visitor who is not signed in.
 */
export function useMe() {
  return useQuery<MeResponse | null, ApiError>({
    queryKey: ME_KEY,
    queryFn: () => apiGetOrNull<MeResponse>('/auth/me'),
    retry: false,
    staleTime: 60_000,
  })
}

/**
 * The ways of signing in that are turned on. Asked for by what offers them (the dialog, the hero), so a visitor who is
 * signed in never causes the request. A failed answer leaves `data` undefined; the FACEIT button then stays muted.
 */
export function useAuthProviders() {
  return useQuery<AuthProvidersResponse, ApiError>({
    queryKey: ['auth', 'providers'],
    queryFn: () => apiGet<AuthProvidersResponse>('/auth/providers'),
    retry: false,
    staleTime: 5 * 60_000,
  })
}

/**
 * Signs out: the backend drops the session, and the cache then holds no visitor, so every page redraws itself.
 * `onSignedOut` runs after that, for the one thing the cache cannot say: that the visitor chose to sign out (and did
 * not, say, lose the session), which is when the focus has somewhere to go.
 */
export function useLogout(onSignedOut?: () => void) {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError>({
    // Not `apiPost`: that one carries the admin key and reads a JSON body, and this answer (204) has neither.
    mutationFn: async () => {
      let res: Response
      try {
        res = await fetch('/api/v1/auth/logout', { method: 'POST', headers: { Accept: 'application/json' } })
      } catch (error) {
        throw new ApiError(0, 'NETWORK_ERROR', error instanceof Error ? error.message : 'Network request failed')
      }
      if (!res.ok) {
        throw new ApiError(res.status, 'UNKNOWN', `Request failed with status ${res.status}`)
      }
    },
    onSuccess: async () => {
      // A refetch of the visitor that is still on its way would write the old visitor back over the `null`.
      await queryClient.cancelQueries({ queryKey: ME_KEY })
      queryClient.setQueryData<MeResponse | null>(ME_KEY, null)
      onSignedOut?.()
    },
  })
}

/**
 * Where the browser goes to sign in with a provider. It is a navigation of the whole page, not a request of the app:
 * the provider's own page asks for the confirmation, and the backend brings the visitor back to `returnTo` (a path of
 * this site) once the session exists.
 */
export function signInUrl(provider: AuthProvider, returnTo: string): string {
  return `/api/v1/auth/${provider}/start?returnTo=${encodeURIComponent(returnTo)}`
}
