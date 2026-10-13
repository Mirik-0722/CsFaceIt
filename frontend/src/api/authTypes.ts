// The shapes of the sign-in answers, apart from the hooks in auth.ts: the browser tests (e2e/) type their fixtures with
// them, and that project cannot follow the imports of a module that has React behind it. Like types.ts, this file
// imports nothing.

export type UserRole = 'USER' | 'ADMIN'

/** One daily limit of a signed-in visitor: how many are left of how many, and when the count starts again. */
export interface ActionLimit {
  limit: number
  remaining: number
  /** The instant the oldest counted action leaves the window; null while nothing is counted. */
  resetsAt: string | null
}

/** The limits of a signed-in visitor who is not an administrator, one per kind of write that is counted. */
export interface MeLimits {
  demoUploads: ActionLimit
  demoImports: ActionLimit
  clipOrders: ActionLimit
}

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
  /**
   * What is left of the day's limits; null for an administrator, who has none. A backend that does not count yet
   * leaves the field out: that is "no limit known", and the pages then name no number.
   */
  limits?: MeLimits | null
}

/** Which ways of signing in the backend has turned on. */
export interface AuthProvidersResponse {
  steam: boolean
  faceit: boolean
}

export type AuthProvider = 'steam' | 'faceit'
