export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Parsed JSON response body, when the server sent one — e.g. a 402's `requiredCents`/`balanceCents`. */
    public body?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(handler: () => void): () => void {
  onUnauthorized = handler
  return () => {
    if (onUnauthorized === handler) onUnauthorized = null
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(path, { ...init, headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { message?: string })
    if (res.status === 401) onUnauthorized?.()
    throw new ApiError(res.status, body.message ?? res.statusText, body)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}
