/** A fetch Response that streams the given server-sent events, one network chunk each. */
export function sseResponse(events: [name: string, data: unknown][]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const [name, data] of events) {
        controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}
