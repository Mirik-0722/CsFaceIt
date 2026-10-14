// The answers of the CS2 link (`/api/v1/cs2/link`, plan 6c), apart from the hooks in `cs2.ts` so that the E2E fixtures
// can type their mocked answers with them (like `types.ts`, this file imports nothing).

/**
 * Where the link of the visitor's matchmaking games stands: `ACTIVE` (new matches are fetched by themselves),
 * `BAD_AUTH_CODE` (Steam refused the authentication code: it was revoked or replaced) or `BAD_SHARE_CODE` (the last known
 * match sharing code is not this account's).
 */
export type Cs2LinkState = 'ACTIVE' | 'BAD_AUTH_CODE' | 'BAD_SHARE_CODE'

/**
 * The visitor's link, as `GET` and `POST /cs2/link` answer it. The authentication code itself is never in an answer.
 * `checkedAt` is null until the chain has been walked once. `state` is one of {@link Cs2LinkState}, typed as a plain
 * string because a newer backend may name a state this page does not know (the page then shows the link as linked,
 * with no word on its state).
 */
export interface Cs2LinkResponse {
  state: string
  linkedAt: string
  checkedAt: string | null
}

/** What `POST /cs2/link` takes: the authentication code (`AAAA-AAAAA-AAAA`) and a match sharing code (`CSGO-…`). */
export interface Cs2LinkRequest {
  authCode: string
  shareCode: string
}
