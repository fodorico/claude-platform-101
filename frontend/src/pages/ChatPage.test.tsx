import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
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
    thinking: null,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    rating: null,
    version_group: id,
    is_active: true,
    attachments: [],
  }
}

function conversation(id: number, title: string): ConversationRead {
  return {
    id,
    title,
    archived_at: null,
    pinned_at: null,
    system_prompt: null,
    temperature: null,
    max_tokens: null,
    show_thinking: false,
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

type StreamOutcome =
  | { ok: true }
  | { ok: false; detail: string; status: number }
  // Sends one delta and then waits until the request is aborted.
  | { ok: 'hang' }

/** A stream that sends one delta and stays open until the request is aborted. */
function hangingResponse(signal: AbortSignal | null | undefined): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`event: delta\ndata: {"text":"Half an answer"}\n\n`))
      signal?.addEventListener('abort', () => {
        controller.error(new DOMException('Aborted', 'AbortError'))
      })
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

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
    const { pathname, searchParams } = new URL(url, 'http://test')
    if (pathname === '/api/conversations') {
      const archived = searchParams.get('archived') === 'true'
      const q = searchParams.get('q')?.toLowerCase()
      const listed = chats.filter(
        (chat) =>
          (chat.conversation.archived_at !== null) === archived &&
          (!q || chat.conversation.title.toLowerCase().includes(q)),
      )
      return Promise.resolve(jsonResponse(listed.map((chat) => chat.conversation)))
    }
    if (pathname === '/api/conversations/bulk') {
      const { ids, action } = JSON.parse(init?.body as string) as { ids: number[]; action: string }
      for (const id of ids) {
        const index = chats.findIndex((chat) => chat.conversation.id === id)
        const chat = chats[index]
        if (!chat) continue
        if (action === 'delete') chats.splice(index, 1)
        else chat.conversation.archived_at = action === 'archive' ? '2026-10-30T00:00:00Z' : null
      }
      return Promise.resolve(jsonResponse({ affected: ids.length }))
    }
    const chatMatch = /^\/api\/conversations\/(\d+)$/.exec(pathname)
    if (chatMatch && init?.method === 'PATCH') {
      const chat = chats.find((item) => item.conversation.id === Number(chatMatch[1]))
      const body = JSON.parse(init.body as string) as { title?: string; archived?: boolean }
      if (chat && body.title) chat.conversation.title = body.title
      if (chat && body.archived !== undefined) {
        chat.conversation.archived_at = body.archived ? '2026-10-30T00:00:00Z' : null
      }
      return Promise.resolve(jsonResponse(chat?.conversation))
    }
    if (chatMatch) {
      const chat = chats.find((item) => item.conversation.id === Number(chatMatch[1]))
      return Promise.resolve(
        chat ? jsonResponse(chat.conversation) : jsonResponse({ detail: 'Not found' }, 404),
      )
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
    if (result.ok === 'hang') return Promise.resolve(hangingResponse(init?.signal))
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
    chat.messages = chat.messages.filter((item) => item.id !== body.replaces_id)
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
    await screen.findByRole('option', { name: 'Test', selected: true })

    await user.selectOptions(screen.getByLabelText('Model'), 'gemini:gemini-other')
    await user.type(screen.getByLabelText('Message'), 'Hello{Enter}')

    expect(await screen.findByText('Reply to Hello')).toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toHaveValue('')
    expect(router.state.location.search).toBe('?chat=100')

    await user.type(screen.getByLabelText('Message'), 'Again{Enter}')
    expect(await screen.findByText('Reply to Again')).toBeInTheDocument()

    expect(sent).toEqual([
      {
        content: 'Hello',
        conversation_id: null,
        provider: 'gemini',
        model: 'gemini-other',
        replaces_id: null,
      },
      {
        content: 'Again',
        conversation_id: 100,
        provider: 'gemini',
        model: 'gemini-other',
        replaces_id: null,
      },
    ])
    expect(JSON.parse(localStorage.getItem('model') ?? '{}')).toEqual({
      provider: 'gemini',
      model: 'gemini-other',
    })
  })

  it('offers providers without an API key as disabled', async () => {
    mockApi()
    renderApp()

    expect(await screen.findByRole('option', { name: 'Opus 5.5' })).toBeDisabled()
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
    const row = await within(history).findByRole('button', { name: 'Title: Hello' })
    // The chat's URL is set right after the list refreshes; wait for both.
    await waitFor(() => {
      expect(row).toHaveAttribute('aria-current', 'page')
    })
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

  describe('controlling the answer', () => {
    it('stops an answer and keeps what arrived, unsaved', async () => {
      const user = userEvent.setup()
      const sent = mockApi([mcpChat()], () => ({ ok: 'hang' }))
      renderApp('/?chat=1')

      await user.type(await screen.findByLabelText('Message'), 'Long one{Enter}')
      expect(await screen.findByText('Half an answer')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Stop answering' }))

      expect(await screen.findByText("Stopped. This answer wasn't saved.")).toBeInTheDocument()
      expect(screen.getByText('Half an answer')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
      expect(sent).toHaveLength(1)
    })

    it('regenerates the last answer in place', async () => {
      const user = userEvent.setup()
      const sent = mockApi([mcpChat()])
      renderApp('/?chat=1')
      await screen.findByText('Reply to And tools?')

      // Only the last answer can be regenerated.
      const [regenerate, ...others] = screen.getAllByRole('button', { name: 'Regenerate answer' })
      expect(others).toEqual([])
      if (regenerate) await user.click(regenerate)

      await waitFor(() => {
        expect(screen.getAllByText('And tools?')).toHaveLength(1)
      })
      expect(sent).toEqual([expect.objectContaining({ content: 'And tools?', replaces_id: 2 })])
    })

    it('edits and resends the last question', async () => {
      const user = userEvent.setup()
      const sent = mockApi([mcpChat()])
      renderApp('/?chat=1')
      await screen.findByText('Reply to And tools?')

      expect(screen.getAllByRole('button', { name: 'Edit question' })).toHaveLength(1)
      await user.click(screen.getByRole('button', { name: 'Edit question' }))
      const box = screen.getByLabelText('Message')
      expect(box).toHaveValue('And tools?')
      expect(screen.getByText('Editing your last message')).toBeInTheDocument()

      await user.clear(box)
      await user.type(box, 'And resources?{Enter}')

      expect(await screen.findByText('Reply to And resources?')).toBeInTheDocument()
      expect(screen.queryByText('Reply to And tools?')).not.toBeInTheDocument()
      expect(screen.queryByText('Editing your last message')).not.toBeInTheDocument()
      expect(sent).toEqual([
        expect.objectContaining({ content: 'And resources?', conversation_id: 1, replaces_id: 2 }),
      ])
    })

    it('cancels an edit', async () => {
      const user = userEvent.setup()
      mockApi([mcpChat()])
      renderApp('/?chat=1')

      await user.click(await screen.findByRole('button', { name: 'Edit question' }))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.getByLabelText('Message')).toHaveValue('')
      expect(screen.queryByText('Editing your last message')).not.toBeInTheDocument()
    })

    it('retries a failed message', async () => {
      const user = userEvent.setup()
      let failures = 1
      const sent = mockApi([], () =>
        failures-- > 0
          ? { ok: false, detail: 'The Gemini API returned an error', status: 503 }
          : { ok: true },
      )
      renderApp()

      await user.type(await screen.findByLabelText('Message'), 'Hello{Enter}')
      await user.click(await screen.findByRole('button', { name: 'Retry' }))

      expect(await screen.findByText('Reply to Hello')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Message')).toHaveValue('')
      expect(sent).toHaveLength(2)
    })
  })

  it('shows the chat title and exports the chat as Markdown', async () => {
    const user = userEvent.setup()
    mockApi([mcpChat()])
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:chat')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    renderApp('/?chat=1')

    expect(await screen.findByRole('heading', { name: 'About MCP' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Export chat as Markdown' }))

    expect(click).toHaveBeenCalledOnce()
    const markdown = await createObjectURL.mock.calls[0]?.[0].text()
    expect(markdown).toContain('# About MCP')
    expect(markdown).toContain('Reply to And tools?')
    click.mockRestore()
  })

  it('shows the totals of the open chat in the details', async () => {
    const chat = mcpChat()
    chat.messages[0] = { ...chat.messages[0], model: 'gemini-other' } as ExchangeRead
    mockApi([chat])
    localStorage.setItem('panels', JSON.stringify({ history: false, details: true }))
    renderApp('/?chat=1')

    const details = await screen.findByRole('complementary', { name: 'Request details' })
    const totals = await within(details).findByRole('region', { name: 'This chat' })
    expect(within(totals).getByText('Messages', { selector: 'dt' }).nextSibling).toHaveTextContent(
      '2',
    )
    expect(
      within(totals).getByText('Input tokens', { selector: 'dt' }).nextSibling,
    ).toHaveTextContent('24')
    expect(
      within(totals).getByText('Total time', { selector: 'dt' }).nextSibling,
    ).toHaveTextContent('2.4 s')
    const byModel = within(totals).getByRole('table', { name: 'Usage by model' })
    expect(within(byModel).getByRole('row', { name: 'Other 1 12 / 34' })).toBeInTheDocument()
    expect(within(byModel).getByRole('row', { name: 'Test 1 12 / 34' })).toBeInTheDocument()
  })

  it('searches the chats in the history', async () => {
    const user = userEvent.setup()
    mockApi([mcpChat(), { conversation: conversation(2, 'Prompt tips'), messages: [] }])
    renderApp()

    await user.click(await screen.findByRole('button', { name: 'History' }))
    const history = screen.getByRole('complementary', { name: 'History' })
    await within(history).findByRole('button', { name: 'Prompt tips' })
    await user.type(within(history).getByRole('searchbox', { name: 'Search chats' }), 'mcp')

    await waitFor(() => {
      expect(within(history).queryByRole('button', { name: 'Prompt tips' })).not.toBeInTheDocument()
    })
    expect(await within(history).findByRole('button', { name: 'About MCP' })).toBeInTheDocument()

    await user.clear(within(history).getByRole('searchbox', { name: 'Search chats' }))
    await user.type(within(history).getByRole('searchbox', { name: 'Search chats' }), 'nothing')
    expect(await within(history).findByText('No chats match your search.')).toBeInTheDocument()
  })

  describe('keyboard shortcuts', () => {
    it('opens the history search with Ctrl+K', async () => {
      const user = userEvent.setup()
      mockApi([mcpChat()])
      renderApp()
      await screen.findByLabelText('Message')

      await user.keyboard('{Control>}k{/Control}')

      const search = await screen.findByRole('searchbox', { name: 'Search chats' })
      await waitFor(() => {
        expect(search).toHaveFocus()
      })
    })

    it('starts a new chat with Ctrl+Shift+O', async () => {
      const user = userEvent.setup()
      mockApi([mcpChat()])
      const router = renderApp('/?chat=1')
      await screen.findByText('Reply to And tools?')

      await user.keyboard('{Control>}{Shift>}o{/Shift}{/Control}')

      await waitFor(() => {
        expect(router.state.location.search).toBe('')
      })
      expect(await screen.findByText(/No messages yet/)).toBeInTheDocument()
    })

    it('focuses the message box with / and lists the shortcuts with ?', async () => {
      const user = userEvent.setup()
      mockApi()
      renderApp()
      const box = await screen.findByLabelText('Message')

      await user.keyboard('/')
      await waitFor(() => {
        expect(box).toHaveFocus()
      })
      expect(box).toHaveValue('')

      // Typed in the message box, "?" is just text.
      await user.keyboard('?')
      expect(box).toHaveValue('?')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      box.blur()
      await user.keyboard('?')
      const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
      expect(within(dialog).getByText('Search chats')).toBeInTheDocument()
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  describe('managing chats in the history', () => {
    const chats = () => [
      mcpChat(),
      { conversation: conversation(2, 'Prompt tips'), messages: [] },
      { conversation: conversation(3, 'Old idea'), messages: [] },
    ]

    async function openHistory() {
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: 'History' }))
      const history = screen.getByRole('complementary', { name: 'History' })
      await within(history).findByRole('button', { name: 'About MCP' })
      return { user, history }
    }

    it('renames a chat from its options', async () => {
      mockApi(chats())
      renderApp()
      const { user, history } = await openHistory()

      await user.click(within(history).getByRole('button', { name: 'Options for Prompt tips' }))
      await user.click(within(history).getByRole('button', { name: 'Rename' }))
      const input = within(history).getByLabelText('Chat title')
      await user.clear(input)
      await user.type(input, 'Better prompts{Enter}')

      expect(
        await within(history).findByRole('button', { name: 'Better prompts' }),
      ).toBeInTheDocument()
    })

    it('cancels a rename with Escape', async () => {
      const sent = mockApi(chats())
      renderApp()
      const { user, history } = await openHistory()

      await user.click(within(history).getByRole('button', { name: 'Options for Prompt tips' }))
      await user.click(within(history).getByRole('button', { name: 'Rename' }))
      await user.type(within(history).getByLabelText('Chat title'), ' changed{Escape}')

      expect(within(history).getByRole('button', { name: 'Prompt tips' })).toBeInTheDocument()
      expect(sent).toEqual([])
    })

    it('archives a chat and brings it back from the archived list', async () => {
      mockApi(chats())
      renderApp()
      const { user, history } = await openHistory()

      await user.click(within(history).getByRole('button', { name: 'Options for Old idea' }))
      await user.click(within(history).getByRole('button', { name: 'Archive' }))
      await waitFor(() => {
        expect(within(history).queryByRole('button', { name: 'Old idea' })).not.toBeInTheDocument()
      })

      await user.click(within(history).getByRole('button', { name: 'Archived' }))
      await user.click(await within(history).findByRole('button', { name: 'Options for Old idea' }))
      await user.click(within(history).getByRole('button', { name: 'Unarchive' }))
      expect(await within(history).findByText('No archived chats.')).toBeInTheDocument()
    })

    it('archives several selected chats at once', async () => {
      mockApi(chats())
      renderApp()
      const { user, history } = await openHistory()

      await user.click(within(history).getByRole('button', { name: 'Select' }))
      await user.click(within(history).getByRole('checkbox', { name: 'About MCP' }))
      await user.click(within(history).getByRole('checkbox', { name: 'Prompt tips' }))
      expect(within(history).getByText('2 selected')).toBeInTheDocument()
      await user.click(within(history).getByRole('button', { name: 'Archive' }))

      await waitFor(() => {
        expect(within(history).queryByText('About MCP')).not.toBeInTheDocument()
      })
      expect(within(history).getByRole('button', { name: 'Old idea' })).toBeInTheDocument()
    })

    it('deletes the selected chats after confirming and leaves the open one', async () => {
      mockApi(chats())
      const router = renderApp('/?chat=1')
      const { user, history } = await openHistory()

      await user.click(within(history).getByRole('button', { name: 'Select' }))
      await user.click(within(history).getByRole('checkbox', { name: 'Select all' }))
      await user.click(within(history).getByRole('button', { name: 'Delete' }))
      const dialog = screen.getByRole('alertdialog', { name: 'Delete 3 chats?' })
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

      expect(await within(history).findByText('Your chats will appear here.')).toBeInTheDocument()
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(router.state.location.search).toBe('')
      expect(await screen.findByText(/No messages yet/)).toBeInTheDocument()
    })

    it('keeps the chat when the deletion is cancelled', async () => {
      mockApi(chats())
      renderApp()
      const { user, history } = await openHistory()

      await user.click(within(history).getByRole('button', { name: 'Options for About MCP' }))
      await user.click(within(history).getByRole('button', { name: 'Delete' }))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(within(history).getByRole('button', { name: 'About MCP' })).toBeInTheDocument()
    })
  })
})
