import type { ApiErrorBody } from './types'

const API_PREFIX = '/api/v1'

/** Why a request failed: the HTTP status (0 when no response arrived) and a stable machine-readable code. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/** Encodes one path segment; dot segments are escaped too, so a crafted id cannot climb out of the API prefix. */
function encodeSegment(segment: string): string {
  const encoded = encodeURIComponent(segment)
  return encoded === '.' || encoded === '..' ? encoded.replaceAll('.', '%2E') : encoded
}

function buildUrl(path: string, params?: Record<string, string | number>): string {
  const encodedPath = path.split('/').map(encodeSegment).join('/')
  const query = new URLSearchParams(Object.entries(params ?? {}).map(([key, value]) => [key, String(value)])).toString()
  return `${API_PREFIX}${encodedPath}${query ? `?${query}` : ''}`
}

function isApiErrorBody(body: unknown): body is ApiErrorBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as Partial<ApiErrorBody>).code === 'string' &&
    typeof (body as Partial<ApiErrorBody>).message === 'string'
  )
}

async function toApiError(res: Response): Promise<ApiError> {
  const body: unknown = await res.json().catch(() => null)
  return isApiErrorBody(body)
    ? new ApiError(res.status, body.code, body.message)
    : new ApiError(res.status, 'UNKNOWN', `Request failed with status ${res.status}`)
}

/**
 * GETs `/api/v1{path}` and returns the parsed JSON body. Every failure is an {@link ApiError}: the code from the
 * backend's error body, `UNKNOWN` when the body is not that JSON, `NETWORK_ERROR` (status 0) when no response arrived.
 * `path` is built from raw segments (`/players/${id}`); each segment and every query value is URL-encoded here.
 */
export async function apiGet<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  let res: Response
  try {
    res = await fetch(buildUrl(path, params), { headers: { Accept: 'application/json' } })
  } catch (error) {
    throw new ApiError(0, 'NETWORK_ERROR', error instanceof Error ? error.message : 'Network request failed')
  }
  if (!res.ok) {
    throw await toApiError(res)
  }
  try {
    return (await res.json()) as T
  } catch {
    throw new ApiError(res.status, 'UNKNOWN', 'Response is not valid JSON')
  }
}
