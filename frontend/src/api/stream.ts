import type { ExchangeRead, MessageCreate } from './generated/model'
import { ApiError, readErrorMessage } from './http'

// The generated client can't consume server-sent events, so POST /api/messages/stream is read
// here. These mirror StreamDelta, StreamThinking, StreamTitle and StreamError in
// backend/app/schemas.py.
interface StreamDelta {
  text: string
}

interface StreamThinking {
  text: string
}

export interface StreamTitle {
  conversation_id: number
  title: string
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
  /** Called with each piece of the model's reasoning, when the chat shows it. */
  onThinking?: (text: string) => void
  /** Called as soon as the exchange is stored, before a possible title arrives. */
  onDone?: (exchange: ExchangeRead) => void
  /** Called when the model titled a new conversation. */
  onTitle?: (title: StreamTitle) => void
  signal?: AbortSignal
}

/** Send a message and stream the answer; resolves with the stored exchange when the stream
 * ends (for a new conversation, after its title). */
export async function streamAnswer(
  message: MessageCreate,
  { onDelta, onThinking, onDone, onTitle, signal }: StreamAnswerOptions,
): Promise<ExchangeRead> {
  const response = await fetch('/api/messages/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(message),
    signal,
  })
  if (!response.ok || !response.body) {
    throw new ApiError(response.status, await readErrorMessage(response))
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let exchange: ExchangeRead | null = null
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
      else if (event?.name === 'thinking') onThinking?.((event.data as StreamThinking).text)
      else if (event?.name === 'done') {
        exchange = event.data as ExchangeRead
        onDone?.(exchange)
      } else if (event?.name === 'title') onTitle?.(event.data as StreamTitle)
      else if (event?.name === 'error') {
        const error = event.data as StreamError
        throw new ApiError(error.status, error.detail)
      }
    }
  }
  if (exchange) return exchange
  throw new ApiError(502, 'The answer was interrupted. Try again.')
}
