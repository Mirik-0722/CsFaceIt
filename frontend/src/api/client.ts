import type { ApiErrorBody } from './types'

const API_PREFIX = '/api/v1'

/**
 * Why a request failed: the HTTP status (0 when no response arrived) and a stable machine-readable code. `retryAt` is
 * set by a refusal that ends by itself (429, a used-up limit): the instant from which the request is possible again, as
 * an ISO-8601 string; null for every other failure.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly retryAt: string | null

  constructor(status: number, code: string, message: string, retryAt: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.retryAt = retryAt
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

/**
 * When a refused request is possible again: the body's `retryAt`, else the `Retry-After` header, which the backend
 * sends as a number of seconds (measured from now, on the browser's clock). Null when the answer names neither.
 */
function retryAtOf(res: Response, body: unknown): string | null {
  const named = isApiErrorBody(body) ? body.retryAt : null
  if (typeof named === 'string' && !Number.isNaN(Date.parse(named))) {
    return named
  }
  const header = res.headers.get('Retry-After')
  const seconds = header !== null && /^[0-9]{1,9}$/.test(header.trim()) ? Number(header) : null
  return seconds === null ? null : new Date(Date.now() + seconds * 1000).toISOString()
}

async function toApiError(res: Response): Promise<ApiError> {
  // A refusal that is not the backend's own (the server's plain-text answer to a cross-origin write) has no JSON body.
  const body: unknown = await res.json().catch(() => null)
  const retryAt = retryAtOf(res, body)
  return isApiErrorBody(body)
    ? new ApiError(res.status, body.code, body.message, retryAt)
    : new ApiError(res.status, 'UNKNOWN', `Request failed with status ${res.status}`, retryAt)
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

/** Reads the JSON body of a successful response; a body that is not JSON is an {@link ApiError}. */
async function parseJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T
  } catch {
    throw new ApiError(res.status, 'UNKNOWN', 'Response is not valid JSON')
  }
}

/** Sends the request and returns the parsed JSON body; every failure is an {@link ApiError}. */
async function request<T>(url: string, init: RequestInit): Promise<T> {
  return parseJson<T>(await send(url, init))
}

/**
 * GETs `/api/v1{path}` and returns the parsed JSON body. Every failure is an {@link ApiError}: the code from the
 * backend's error body, `UNKNOWN` when the body is not that JSON, `NETWORK_ERROR` (status 0) when no response arrived.
 * `path` is built from raw segments (`/players/${id}`); each segment and every query value is URL-encoded here.
 */
export async function apiGet<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  return request<T>(buildUrl(path, params), { headers: { Accept: 'application/json' } })
}

/**
 * GETs like {@link apiGet}, for an endpoint whose answer may be "nothing to show" by design: `204 No Content` (no body)
 * is `null`, where {@link apiGet} would call the empty body invalid JSON. Every other failure is an {@link ApiError}.
 */
export async function apiGetOrNull<T>(path: string): Promise<T | null> {
  const res = await send(buildUrl(path), { headers: { Accept: 'application/json' } })
  return res.status === 204 ? null : parseJson<T>(res)
}

interface WriteOptions {
  /**
   * The admin key, for the `X-API-Key` header, when the visitor typed one. Without it the request is the signed-in
   * visitor's: the browser sends the session cookie with every request to the site's own origin.
   */
  apiKey?: string
}

interface PostOptions extends WriteOptions {
  /** A `FormData` goes out as it is (the browser adds the multipart boundary); anything else as JSON. */
  body?: FormData | object
}

/** The headers of a write: the admin key only when there is one (an empty header would be a wrong key). */
function writeHeaders(apiKey: string | undefined): Record<string, string> {
  return apiKey ? { Accept: 'application/json', 'X-API-Key': apiKey } : { Accept: 'application/json' }
}

/**
 * POSTs to `/api/v1{path}`, as the signed-in visitor or with the admin key, and returns the parsed JSON body; it fails
 * as {@link apiGet} does.
 */
export async function apiPost<T>(path: string, { apiKey, body }: PostOptions = {}): Promise<T> {
  const headers = writeHeaders(apiKey)
  if (body instanceof FormData) {
    return request<T>(buildUrl(path), { method: 'POST', headers, body })
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    return request<T>(buildUrl(path), { method: 'POST', headers, body: JSON.stringify(body) })
  }
  return request<T>(buildUrl(path), { method: 'POST', headers })
}

/**
 * DELETEs `/api/v1{path}`, as the signed-in visitor or with the admin key. The answer has no body; it fails as
 * {@link apiGet} does.
 */
export async function apiDelete(path: string, { apiKey }: WriteOptions = {}): Promise<void> {
  await send(buildUrl(path), { method: 'DELETE', headers: writeHeaders(apiKey) })
}
