import type { Page } from '@playwright/test'
import type { ConversationRead, ExchangeRead, MessageCreate } from '../src/api/generated/model'

/** The stored conversation that `history` belongs to; open it with `/?chat=1`. */
export const CHAT_URL = '/?chat=1'

export function exchange(
  id: number,
  prompt: string,
  reply: string,
  conversationId = 1,
): ExchangeRead {
  return {
    id,
    conversation_id: conversationId,
    prompt,
    reply,
    provider: 'gemini',
    model: 'gemini-flash-lite-latest',
    stop_reason: 'STOP',
    input_tokens: 12,
    output_tokens: 34,
    duration_ms: 1200,
    first_token_ms: 400,
    created_at: new Date().toISOString(),
    thinking: null,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    rating: null,
    version_group: id,
    is_active: true,
    attachments: [],
  }
}

type Answer = { reply: string } | { error: string; status: number }

function sse(events: [string, unknown][]): string {
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('')
}

const modelSettings = {
  default_provider: 'gemini',
  providers: [
    { name: 'claude', available: false, models: ['claude-opus-5-5', 'claude-sonnet-5-5'] },
    {
      name: 'gemini',
      available: true,
      models: ['gemini-flash-lite-latest', 'gemini-flash-latest'],
    },
  ],
  max_tokens: 16000,
  system_prompt: 'Answer briefly.',
  prices: [
    { model: 'gemini-flash-lite', input: 0.3, output: 2.5, cache_read: 0.03, cache_write: 0 },
  ],
}

interface Chat {
  conversation: ConversationRead
  messages: ExchangeRead[]
}

/**
 * Fakes the backend for one page. `history` holds the messages (oldest first) of conversation 1,
 * "Earlier chat"; POST /api/messages/stream answers with `answer(prompt)`, storing successful
 * exchanges and titling new conversations "Chat: <first message>".
 */
export async function mockApi(
  page: Page,
  { history = [], answer }: { history?: ExchangeRead[]; answer: (prompt: string) => Answer },
) {
  const now = new Date().toISOString()
  const chats: Chat[] = history.length
    ? [
        {
          conversation: {
            id: 1,
            title: 'Earlier chat',
            archived_at: null,
            pinned_at: null,
            system_prompt: null,
            temperature: null,
            max_tokens: null,
            show_thinking: false,
            created_at: now,
            updated_at: now,
          },
          messages: [...history],
        },
      ]
    : []
  let nextId = 100

  await page.route('**/api/model-settings', (route) => route.fulfill({ json: modelSettings }))
  await page.route('**/api/conversations?*', (route) => {
    const params = new URL(route.request().url()).searchParams
    const archived = params.get('archived') === 'true'
    const q = params.get('q')?.toLowerCase()
    const listed = chats.filter(
      (chat) =>
        (chat.conversation.archived_at !== null) === archived &&
        (!q || chat.conversation.title.toLowerCase().includes(q)),
    )
    return route.fulfill({ json: listed.map((chat) => chat.conversation) })
  })
  await page.route('**/api/conversations/bulk', (route) => {
    const { ids, action } = route.request().postDataJSON() as { ids: number[]; action: string }
    for (const id of ids) {
      const index = chats.findIndex((chat) => chat.conversation.id === id)
      const chat = chats[index]
      if (!chat) continue
      if (action === 'delete') chats.splice(index, 1)
      else chat.conversation.archived_at = action === 'archive' ? now : null
    }
    return route.fulfill({ json: { affected: ids.length } })
  })
  await page.route(/\/api\/conversations\/\d+$/, (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/').pop())
    const chat = chats.find((item) => item.conversation.id === id)
    if (!chat) return route.fulfill({ status: 404, json: { detail: 'Conversation not found' } })
    if (route.request().method() === 'GET') return route.fulfill({ json: chat.conversation })
    const body = route.request().postDataJSON() as {
      title?: string
      archived?: boolean
      pinned?: boolean
      settings?: Partial<ConversationRead>
    }
    if (body.title) chat.conversation.title = body.title
    if (body.archived !== undefined) chat.conversation.archived_at = body.archived ? now : null
    if (body.pinned !== undefined) chat.conversation.pinned_at = body.pinned ? now : null
    if (body.settings) Object.assign(chat.conversation, body.settings)
    return route.fulfill({ json: chat.conversation })
  })
  await page.route(/\/api\/exchanges\/\d+$/, (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/').pop())
    const all = chats.flatMap((chat) => chat.messages)
    const target = all.find((item) => item.id === id)
    if (!target) return route.fulfill({ status: 404, json: { detail: 'Message not found' } })
    const body = route.request().postDataJSON() as { rating?: number; active?: boolean }
    if (body.rating !== undefined) target.rating = body.rating || null
    if (body.active) {
      for (const item of all) {
        if (item.version_group === target.version_group) item.is_active = item.id === id
      }
    }
    return route.fulfill({ json: target })
  })
  await page.route('**/api/exchanges/*/api-call', (route) =>
    route.fulfill({
      json: {
        provider: 'gemini',
        request: {
          model: 'gemini-flash-lite-latest',
          system_instruction: 'Answer briefly.',
          contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
        },
        usage: { prompt_token_count: 12, candidates_token_count: 34 },
      },
    }),
  )
  await page.route('**/api/messages/count-tokens', (route) => {
    const body = route.request().postDataJSON() as MessageCreate
    return route.fulfill({ json: { input_tokens: body.content.split(' ').length * 3 } })
  })
  const prompts: { id: number; title: string; content: string; created_at: string }[] = []
  await page.route(/\/api\/prompts(\/\d+)?$/, (route) => {
    const request = route.request()
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as { title: string; content: string }
      prompts.push({ id: nextId++, ...body, created_at: now })
      return route.fulfill({ status: 201, json: prompts.at(-1) })
    }
    if (request.method() === 'DELETE') {
      const id = Number(new URL(request.url()).pathname.split('/').pop())
      prompts.splice(
        prompts.findIndex((item) => item.id === id),
        1,
      )
      return route.fulfill({ status: 204 })
    }
    return route.fulfill({ json: prompts })
  })
  await page.route('**/api/conversations/*/messages', (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/')[3])
    const chat = chats.find((item) => item.conversation.id === id)
    return chat
      ? route.fulfill({ json: chat.messages })
      : route.fulfill({ status: 404, json: { detail: 'Conversation not found' } })
  })
  await page.route('**/api/messages/stream', async (route) => {
    const body = route.request().postDataJSON() as MessageCreate
    const result = answer(body.content)
    if ('error' in result) {
      await route.fulfill({
        contentType: 'text/event-stream',
        body: sse([['error', { detail: result.error, status: result.status }]]),
      })
      return
    }
    let chat: Chat | undefined = chats.find((item) => item.conversation.id === body.conversation_id)
    if (!chat) {
      const id = nextId++
      chat = {
        conversation: {
          id,
          title: `Chat: ${body.content}`,
          archived_at: null,
          pinned_at: null,
          system_prompt: null,
          temperature: null,
          max_tokens: null,
          show_thinking: false,
          created_at: now,
          updated_at: now,
        },
        messages: [],
      }
      chats.unshift(chat)
    }
    const created = exchange(nextId++, body.content, result.reply, chat.conversation.id)
    // A regenerated or edited message becomes a new active version of the replaced one.
    const replaced = chat.messages.find((item) => item.id === body.replaces_id)
    if (replaced) {
      created.version_group = replaced.version_group
      for (const item of chat.messages) {
        if (item.version_group === replaced.version_group) item.is_active = false
      }
    }
    const showThinking = body.settings?.show_thinking ?? chat.conversation.show_thinking
    if (body.settings) Object.assign(chat.conversation, body.settings)
    if (showThinking) created.thinking = 'First, recall what an API is.'
    chat.messages.push(created)
    const middle = Math.ceil(result.reply.length / 2)
    const events: [string, unknown][] = [
      ...(showThinking ? [['thinking', { text: created.thinking }] as [string, unknown]] : []),
      ['delta', { text: result.reply.slice(0, middle) }],
      ['delta', { text: result.reply.slice(middle) }],
      ['done', created],
    ]
    if (body.conversation_id == null) {
      events.push([
        'title',
        { conversation_id: chat.conversation.id, title: chat.conversation.title },
      ])
    }
    await route.fulfill({ contentType: 'text/event-stream', body: sse(events) })
  })
}
