import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExchangeRead } from '../api/generated/model'
import { routes } from '../routes'
import { sseResponse } from '../test/sse'

function exchange(id: number, prompt: string): ExchangeRead {
  return {
    id,
    prompt,
    reply: `Reply to ${prompt}`,
    model: 'claude-opus-5-5',
    created_at: '2026-10-29T12:00:00Z',
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type StreamOutcome = { ok: true } | { ok: false; detail: string; status: number }

/** In-memory fake of the backend: GET returns history, the stream endpoint answers. */
function mockApi(history: ExchangeRead[], outcome: (content: string) => StreamOutcome) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/messages/stream') {
      const { content } = JSON.parse(init?.body as string) as { content: string }
      const result = outcome(content)
      if (!result.ok) {
        return Promise.resolve(
          sseResponse([
            ['delta', { text: 'Partial' }],
            ['error', { detail: result.detail, status: result.status }],
          ]),
        )
      }
      const stored = exchange(history.length + 1, content)
      history.unshift(stored)
      return Promise.resolve(
        sseResponse([
          ['delta', { text: 'Reply to ' }],
          ['delta', { text: content }],
          ['done', stored],
        ]),
      )
    }
    expect(url).toContain('/api/messages')
    return Promise.resolve(jsonResponse(history))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(routes, { initialEntries: ['/'] })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('ChatPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the stored history', async () => {
    mockApi([exchange(1, 'What is MCP?')], () => ({ ok: true }))

    renderApp()

    expect(await screen.findByText('What is MCP?')).toBeInTheDocument()
    expect(screen.getByText('Reply to What is MCP?')).toBeInTheDocument()
  })

  it('streams the answer, clears the form and shows the stored exchange', async () => {
    const user = userEvent.setup()
    mockApi([], () => ({ ok: true }))
    renderApp()
    expect(await screen.findByText(/No messages yet/)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Message'), 'Hello Claude')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('Reply to Hello Claude')).toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toHaveValue('')
  })

  it('sends a suggestion from the empty state', async () => {
    const user = userEvent.setup()
    mockApi([], () => ({ ok: true }))
    renderApp()

    await user.click(
      await screen.findByRole('button', { name: 'Explain what an API is in two sentences' }),
    )

    expect(
      await screen.findByText('Reply to Explain what an API is in two sentences'),
    ).toBeInTheDocument()
  })

  it('sends with Enter and keeps Shift+Enter for new lines', async () => {
    const user = userEvent.setup()
    mockApi([], () => ({ ok: true }))
    renderApp()
    const box = await screen.findByLabelText('Message')

    await user.type(box, 'Line one{Shift>}{Enter}{/Shift}Line two')
    expect(box).toHaveValue('Line one\nLine two')
    await user.type(box, '{Enter}')

    expect(await screen.findByText(/Reply to Line one/)).toBeInTheDocument()
    expect(box).toHaveValue('')
  })

  it('shows the conversation oldest first', async () => {
    mockApi([exchange(2, 'Second question'), exchange(1, 'First question')], () => ({ ok: true }))
    renderApp()

    await screen.findByText('First question')
    const prompts = screen
      .getAllByText(/^(First|Second) question$/)
      .map((element) => element.textContent)

    expect(prompts).toEqual(['First question', 'Second question'])
  })

  it('does not send an empty message', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi([], () => ({ ok: true }))
    renderApp()

    await user.click(await screen.findByRole('button', { name: 'Send' }))

    expect(await screen.findByText('Write a message first.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/messages/stream')).toBe(false)
  })

  it('shows the error from the stream and keeps the text for a retry', async () => {
    const user = userEvent.setup()
    mockApi([], () => ({
      ok: false,
      detail: 'Claude declined to answer this message',
      status: 422,
    }))
    renderApp()

    await user.type(await screen.findByLabelText('Message'), 'Something')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Claude declined to answer this message',
    )
    expect(screen.getByLabelText('Message')).toHaveValue('Something')
    expect(screen.queryByText('Partial')).not.toBeInTheDocument()
  })

  it('explains when the AI service is unavailable', async () => {
    const user = userEvent.setup()
    mockApi([], () => ({ ok: false, detail: 'The Claude API returned an error', status: 503 }))
    renderApp()

    await user.type(await screen.findByLabelText('Message'), 'Something')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The AI service is not available right now',
    )
  })
})
