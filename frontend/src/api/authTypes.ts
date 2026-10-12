// The shapes of the sign-in answers, apart from the hooks in auth.ts: the browser tests (e2e/) type their fixtures with
// them, and that project cannot follow the imports of a module that has React behind it. Like types.ts, this file
// imports nothing.

export type UserRole = 'USER' | 'ADMIN'

/** The signed-in visitor, as `GET /api/v1/auth/me` answers. */
export interface MeResponse {
  id: number
  nickname: string
  /** The FACEIT picture; null when no FACEIT account is linked (or it has none). */
  avatarUrl: string | null
  role: UserRole
  steamId: string | null
  /** The id of `/players/{playerId}`; null while no FACEIT account is linked to this Steam account. */
  playerId: string | null
}

/** Which ways of signing in the backend has turned on. */
export interface AuthProvidersResponse {
  steam: boolean
  faceit: boolean
}

export type AuthProvider = 'steam' | 'faceit'
