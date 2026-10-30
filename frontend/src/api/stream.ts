import type { ExchangeRead } from './generated/model'
import { ApiError, readErrorMessage } from './http'

// The generated client can't consume server-sent events, so POST /api/messages/stream is read
// here. These mirror StreamDelta and StreamError in backend/app/schemas.py.
interface StreamDelta {
  text: string
}

interface StreamError {
  detail: string
  status: number
}

interface ServerSentEvent {
  name: string
  data: unknown
}

function parseEvent(block: string): ServerSentEvent | null {
  let name = 'message'
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) name = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  return data.length ? { name, data: JSON.parse(data.join('\n')) as unknown } : null
}

interface StreamAnswerOptions {
  /** Called with each piece of the answer, in order. */
  onDelta: (text: string) => void
  signal?: AbortSignal
}

/** Send a message and stream the answer; resolves with the stored exchange. */
export async function streamAnswer(
  content: string,
  { onDelta, signal }: StreamAnswerOptions,
): Promise<ExchangeRead> {
  const response = await fetch('/api/messages/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ content }),
    signal,
  })
  if (!response.ok || !response.body) {
    throw new ApiError(response.status, await readErrorMessage(response))
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let end = buffer.indexOf('\n\n')
    while (end !== -1) {
      const event = parseEvent(buffer.slice(0, end))
      buffer = buffer.slice(end + 2)
      end = buffer.indexOf('\n\n')

      if (event?.name === 'delta') onDelta((event.data as StreamDelta).text)
      else if (event?.name === 'done') return event.data as ExchangeRead
      else if (event?.name === 'error') {
        const error = event.data as StreamError
        throw new ApiError(error.status, error.detail)
      }
    }
  }
  throw new ApiError(502, 'The answer was interrupted. Try again.')
}
