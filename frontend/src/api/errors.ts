import { ApiError } from './http'

/** Human-readable message for an error coming from the API or the network. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return 'Too many requests. Wait a moment and try again.'
    if (error.status >= 500) return 'Claude is not available right now. Try again later.'
    return error.message
  }
  return 'Could not reach the server. Check your connection and try again.'
}
