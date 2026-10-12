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

/** Sends the request and returns the response once it is a success; every failure is an {@link ApiError}. */
async function send(url: string, init: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (error) {
    throw new ApiError(0, 'NETWORK_ERROR', error instanceof Error ? error.message : 'Network request failed')
  }
  if (!res.ok) {
    throw await toApiError(res)
  }
  return res
}

/** Sends the request and returns the parsed JSON body; every failure is an {@link ApiError}. */
async function request<T>(url: string, init: RequestInit): Promise<T> {
  const res = await send(url, init)
  try {
    return (await res.json()) as T
  } catch {
    throw new ApiError(res.status, 'UNKNOWN', 'Response is not valid JSON')
  }
}

/**
 * GETs `/api/v1{path}` and returns the parsed JSON body. Every failure is an {@link ApiError}: the code from the
 * backend's error body, `UNKNOWN` when the body is not that JSON, `NETWORK_ERROR` (status 0) when no response arrived.
 * `path` is built from raw segments (`/players/${id}`); each segment and every query value is URL-encoded here.
 */
export async function apiGet<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  return request<T>(buildUrl(path, params), { headers: { Accept: 'application/json' } })
}

interface PostOptions {
  /** The admin key: every request that is not a GET needs it, in the `X-API-Key` header. */
  apiKey: string
  /** A `FormData` goes out as it is (the browser adds the multipart boundary); anything else as JSON. */
  body?: FormData | object
}

/** POSTs to `/api/v1{path}` with the admin key and returns the parsed JSON body; it fails as {@link apiGet} does. */
export async function apiPost<T>(path: string, { apiKey, body }: PostOptions): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-API-Key': apiKey }
  if (body instanceof FormData) {
    return request<T>(buildUrl(path), { method: 'POST', headers, body })
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    return request<T>(buildUrl(path), { method: 'POST', headers, body: JSON.stringify(body) })
  }
  return request<T>(buildUrl(path), { method: 'POST', headers })
}

/** DELETEs `/api/v1{path}` with the admin key. The answer has no body; it fails as {@link apiGet} does. */
export async function apiDelete(path: string, { apiKey }: { apiKey: string }): Promise<void> {
  await send(buildUrl(path), { method: 'DELETE', headers: { Accept: 'application/json', 'X-API-Key': apiKey } })
}
