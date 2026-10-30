import type { Page } from '@playwright/test'
import type { ExchangeRead } from '../src/api/generated/model'

export function exchange(id: number, prompt: string, reply: string): ExchangeRead {
  return { id, prompt, reply, model: 'claude-opus-5-5', created_at: '2026-10-30T12:00:00Z' }
}

type Answer = { reply: string } | { error: string; status: number }

function sse(events: [string, unknown][]): string {
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('')
}

/**
 * Fakes the backend for one page: GET /api/messages returns `history` (newest first, like the
 * API) and POST /api/messages/stream answers with `answer(prompt)`, storing successful exchanges.
 */
export async function mockApi(
  page: Page,
  { history = [], answer }: { history?: ExchangeRead[]; answer: (prompt: string) => Answer },
) {
  const stored = [...history]

  await page.route('**/api/messages?*', (route) => route.fulfill({ json: stored }))
  await page.route('**/api/messages/stream', async (route) => {
    const { content } = route.request().postDataJSON() as { content: string }
    const result = answer(content)
    if ('error' in result) {
      await route.fulfill({
        contentType: 'text/event-stream',
        body: sse([['error', { detail: result.error, status: result.status }]]),
      })
      return
    }
    const created = exchange(stored.length + 1, content, result.reply)
    stored.unshift(created)
    const middle = Math.ceil(result.reply.length / 2)
    await route.fulfill({
      contentType: 'text/event-stream',
      body: sse([
        ['delta', { text: result.reply.slice(0, middle) }],
        ['delta', { text: result.reply.slice(middle) }],
        ['done', created],
      ]),
    })
  })
}
