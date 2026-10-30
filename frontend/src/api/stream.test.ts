import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './http'
import { streamAnswer } from './stream'

function chunkedResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } })
}

const done = { id: 1, prompt: 'Hi', reply: 'Hello', model: 'm', created_at: '2026-10-30T00:00:00Z' }

describe('streamAnswer', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('handles events split across network chunks', async () => {
    const wire = `event: delta\ndata: {"text":"Hel"}\n\nevent: delta\ndata: {"text":"lo"}\n\nevent: done\ndata: ${JSON.stringify(done)}\n\n`
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(chunkedResponse([wire.slice(0, 17), wire.slice(17, 50), wire.slice(50)])),
      ),
    )
    const deltas: string[] = []

    const result = await streamAnswer({ content: 'Hi' }, { onDelta: (text) => deltas.push(text) })

    expect(deltas).toEqual(['Hel', 'lo'])
    expect(result).toEqual(done)
  })

  it('throws the error event as an ApiError', async () => {
    const wire = 'event: error\ndata: {"detail":"Rate limit reached","status":429}\n\n'
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(chunkedResponse([wire]))),
    )

    await expect(streamAnswer({ content: 'Hi' }, { onDelta: vi.fn() })).rejects.toEqual(
      new ApiError(429, 'Rate limit reached'),
    )
  })

  it('throws when the stream ends without a result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(chunkedResponse(['event: delta\ndata: {"text":"Hel"}\n\n']))),
    )

    await expect(streamAnswer({ content: 'Hi' }, { onDelta: vi.fn() })).rejects.toBeInstanceOf(
      ApiError,
    )
  })

  it('throws the HTTP error when the request is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ detail: 'Bad input' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    )

    await expect(streamAnswer({ content: 'Hi' }, { onDelta: vi.fn() })).rejects.toEqual(
      new ApiError(400, 'Bad input'),
    )
  })

  it('reports the stored exchange, then the title of a new conversation', async () => {
    const title = { conversation_id: 7, title: 'Greetings' }
    const wire = `event: delta\ndata: {"text":"Hello"}\n\nevent: done\ndata: ${JSON.stringify(done)}\n\nevent: title\ndata: ${JSON.stringify(title)}\n\n`
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(chunkedResponse([wire]))),
    )
    const seen: string[] = []

    const result = await streamAnswer(
      { content: 'Hi' },
      {
        onDelta: () => seen.push('delta'),
        onDone: () => seen.push('done'),
        onTitle: (event) => seen.push(`title:${event.title}`),
      },
    )

    expect(seen).toEqual(['delta', 'done', 'title:Greetings'])
    expect(result).toEqual(done)
  })
})
