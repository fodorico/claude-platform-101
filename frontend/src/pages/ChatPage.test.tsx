import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConversationRead, ExchangeRead, MessageCreate } from '../api/generated/model'
import { routes } from '../routes'
import { sseResponse } from '../test/sse'

function exchange(id: number, conversationId: number, prompt: string): ExchangeRead {
  return {
    id,
    conversation_id: conversationId,
    prompt,
    reply: `Reply to ${prompt}`,
    provider: 'gemini',
    model: 'gemini-test',
    stop_reason: 'STOP',
    input_tokens: 12,
    output_tokens: 34,
    duration_ms: 1200,
    first_token_ms: 400,
    created_at: '2026-10-29T12:00:00Z',
  }
}

function conversation(id: number, title: string): ConversationRead {
  return {
    id,
    title,
    created_at: '2026-10-29T12:00:00Z',
    updated_at: '2026-10-29T12:00:00Z',
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const modelSettings = {
  default_provider: 'claude',
  providers: [
    { name: 'claude', available: false, models: ['claude-opus-5-5'] },
    { name: 'gemini', available: true, models: ['gemini-test', 'gemini-other'] },
  ],
  max_tokens: 16000,
  system_prompt: 'Answer briefly.',
}

type StreamOutcome = { ok: true } | { ok: false; detail: string; status: number }

interface FakeChat {
  conversation: ConversationRead
  messages: ExchangeRead[]
}

/** In-memory fake of the backend; returns the stream requests it received. */
function mockApi(
  chats: FakeChat[] = [],
  outcome: (content: string) => StreamOutcome = () => ({ ok: true }),
) {
  const sent: MessageCreate[] = []
  let nextId = 100
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/model-settings') return Promise.resolve(jsonResponse(modelSettings))
    if (url === '/api/conversations') {
      return Promise.resolve(jsonResponse(chats.map((chat) => chat.conversation)))
    }
    const messagesMatch = /^\/api\/conversations\/(\d+)\/messages$/.exec(url)
    if (messagesMatch) {
      const chat = chats.find((item) => item.conversation.id === Number(messagesMatch[1]))
      return Promise.resolve(
        chat ? jsonResponse(chat.messages) : jsonResponse({ detail: 'Not found' }, 404),
      )
    }
    expect(url).toBe('/api/messages/stream')
    const body = JSON.parse(init?.body as string) as MessageCreate
    sent.push(body)
    const result = outcome(body.content)
    if (!result.ok) {
      return Promise.resolve(
        sseResponse([
          ['delta', { text: 'Partial' }],
          ['error', { detail: result.detail, status: result.status }],
        ]),
      )
    }
    let chat = chats.find((item) => item.conversation.id === body.conversation_id)
    const isNew = !chat
    if (!chat) {
      chat = { conversation: conversation(nextId++, body.content), messages: [] }
      chats.unshift(chat)
    }
    const stored = exchange(nextId++, chat.conversation.id, body.content)
    chat.messages.push(stored)
    const events: [string, unknown][] = [
      ['delta', { text: 'Reply to ' }],
      ['delta', { text: body.content }],
      ['done', stored],
    ]
    if (isNew) {
      chat.conversation = { ...chat.conversation, title: `Title: ${body.content}` }
      events.push(['title', { conversation_id: chat.conversation.id, title: 'x' }])
    }
    return Promise.resolve(sseResponse(events))
  })
  vi.stubGlobal('fetch', fetchMock)
  return sent
}

function renderApp(initialEntry = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const mcpChat = (): FakeChat => ({
  conversation: conversation(1, 'About MCP'),
  messages: [exchange(1, 1, 'What is MCP?'), exchange(2, 1, 'And tools?')],
})

describe('ChatPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('opens a stored conversation oldest first', async () => {
    mockApi([mcpChat()])
    renderApp('/?chat=1')

    await screen.findByText('Reply to What is MCP?')
    const prompts = screen
      .getAllByText(/^(What is MCP\?|And tools\?)$/)
      .map((element) => element.textContent)

    expect(prompts).toEqual(['What is MCP?', 'And tools?'])
  })

  it('starts a new chat, then keeps sending into it with the chosen model', async () => {
    const user = userEvent.setup()
    const sent = mockApi()
    const router = renderApp()
    expect(await screen.findByText(/No messages yet/)).toBeInTheDocument()
    // Claude has no API key, so the API default falls back to Gemini.
    await screen.findByRole('option', { name: 'gemini-test', selected: true })

    await user.selectOptions(screen.getByLabelText('Model'), 'gemini:gemini-other')
    await user.type(screen.getByLabelText('Message'), 'Hello{Enter}')

    expect(await screen.findByText('Reply to Hello')).toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toHaveValue('')
    expect(router.state.location.search).toBe('?chat=100')

    await user.type(screen.getByLabelText('Message'), 'Again{Enter}')
    expect(await screen.findByText('Reply to Again')).toBeInTheDocument()

    expect(sent).toEqual([
      { content: 'Hello', conversation_id: null, provider: 'gemini', model: 'gemini-other' },
      { content: 'Again', conversation_id: 100, provider: 'gemini', model: 'gemini-other' },
    ])
    expect(JSON.parse(localStorage.getItem('model') ?? '{}')).toEqual({
      provider: 'gemini',
      model: 'gemini-other',
    })
  })

  it('offers providers without an API key as disabled', async () => {
    mockApi()
    renderApp()

    expect(await screen.findByRole('option', { name: 'claude-opus-5-5' })).toBeDisabled()
    expect(screen.getByRole('group', { name: 'Claude (no API key)' })).toBeInTheDocument()
  })

  it('lists chats in the history and opens them', async () => {
    const user = userEvent.setup()
    mockApi([mcpChat(), { conversation: conversation(2, 'Prompt tips'), messages: [] }])
    const router = renderApp()

    await user.click(await screen.findByRole('button', { name: 'History' }))
    const history = screen.getByRole('complementary', { name: 'History' })
    await user.click(await within(history).findByRole('button', { name: 'About MCP' }))

    expect(await screen.findByText('Reply to And tools?')).toBeInTheDocument()
    expect(router.state.location.search).toBe('?chat=1')
    expect(within(history).getByRole('button', { name: 'About MCP' })).toHaveAttribute(
      'aria-current',
      'page',
    )

    await user.click(within(history).getByRole('button', { name: 'New chat' }))
    expect(await screen.findByText(/No messages yet/)).toBeInTheDocument()
  })

  it('shows the new chat in the history with its title', async () => {
    const user = userEvent.setup()
    mockApi()
    localStorage.setItem('panels', JSON.stringify({ history: true, details: false }))
    renderApp()

    await user.type(await screen.findByLabelText('Message'), 'Hello{Enter}')

    const history = screen.getByRole('complementary', { name: 'History' })
    expect(await within(history).findByRole('button', { name: 'Title: Hello' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('sends a suggestion from the empty state', async () => {
    const user = userEvent.setup()
    mockApi()
    renderApp()

    await user.click(
      await screen.findByRole('button', { name: 'Explain what an API is in two sentences' }),
    )

    expect(
      await screen.findByText('Reply to Explain what an API is in two sentences'),
    ).toBeInTheDocument()
  })

  it('keeps Shift+Enter for new lines', async () => {
    const user = userEvent.setup()
    mockApi()
    renderApp()
    const box = await screen.findByLabelText('Message')

    await user.type(box, 'Line one{Shift>}{Enter}{/Shift}Line two')
    expect(box).toHaveValue('Line one\nLine two')
    await user.type(box, '{Enter}')

    expect(await screen.findByText(/Reply to Line one/)).toBeInTheDocument()
  })

  it('does not send an empty message', async () => {
    const user = userEvent.setup()
    const sent = mockApi()
    renderApp()

    await user.click(await screen.findByRole('button', { name: 'Send' }))

    expect(await screen.findByText('Write a message first.')).toBeInTheDocument()
    expect(sent).toEqual([])
  })

  it('shows the error from the stream and keeps the text for a retry', async () => {
    const user = userEvent.setup()
    mockApi([], () => ({
      ok: false,
      detail: 'Gemini declined to answer this message',
      status: 422,
    }))
    renderApp()

    await user.type(await screen.findByLabelText('Message'), 'Something')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Gemini declined to answer this message',
    )
    expect(screen.getByLabelText('Message')).toHaveValue('Something')
    expect(screen.queryByText('Partial')).not.toBeInTheDocument()
  })

  it('explains when the AI service is unavailable', async () => {
    const user = userEvent.setup()
    mockApi([], () => ({ ok: false, detail: 'The Gemini API returned an error', status: 503 }))
    renderApp()

    await user.type(await screen.findByLabelText('Message'), 'Something')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The AI service is not available right now',
    )
  })

  it('opens the side panels from the header and remembers them', async () => {
    mockApi([mcpChat()])
    const user = userEvent.setup()
    renderApp('/?chat=1')
    await screen.findByText('Reply to What is MCP?')

    expect(screen.queryByRole('complementary', { name: 'History' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'History' }))
    await user.click(screen.getByRole('button', { name: 'Request details' }))

    expect(screen.getByRole('complementary', { name: 'History' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Request details' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('panels') ?? '{}')).toEqual({
      history: true,
      details: true,
    })

    await user.click(screen.getByRole('button', { name: 'Close history' }))
    expect(screen.queryByRole('complementary', { name: 'History' })).not.toBeInTheDocument()
  })

  it('shows the details of the latest answer, or the one picked', async () => {
    const chat = mcpChat()
    chat.messages[0] = { ...chat.messages[0], duration_ms: 850, output_tokens: 7 } as ExchangeRead
    mockApi([chat])
    localStorage.setItem('panels', JSON.stringify({ history: false, details: true }))
    const user = userEvent.setup()
    renderApp('/?chat=1')

    const details = await screen.findByRole('complementary', { name: 'Request details' })
    expect(await within(details).findByText('1.2 s')).toBeInTheDocument()
    expect(within(details).getByText('Gemini')).toBeInTheDocument()

    const [firstInfo] = screen.getAllByRole('button', { name: 'Show request details' })
    if (firstInfo) await user.click(firstInfo)

    expect(within(details).getByText('850 ms')).toBeInTheDocument()
    expect(within(details).getByText('7')).toBeInTheDocument()
    expect(await within(details).findByText('Answer briefly.')).toBeInTheDocument()
  })
})
