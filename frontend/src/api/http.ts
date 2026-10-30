/** Error thrown for any non-2xx API response, so TanStack Query treats it as a failure. */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** FastAPI puts a string (or a list of validation errors) in `detail`. */
export async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null && 'detail' in body) {
      const { detail } = body
      if (typeof detail === 'string') return detail
    }
  } catch {
    // Not JSON: fall through to the generic message.
  }
  return `Request failed with status ${String(response.status)}`
}

/** Fetch wrapper used by the generated API client (see orval.config.ts). */
export async function apiFetch<T>(url: string, options: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorMessage(response))
  }
  return (await response.json()) as T
}
