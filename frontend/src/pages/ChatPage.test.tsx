import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExchangeRead } from '../api/generated/model'
import { routes } from '../routes'

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

/** In-memory fake of the backend: GET returns history, POST runs `onPost`. */
function mockApi(history: ExchangeRead[], onPost: (content: string) => Response) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const { content } = JSON.parse(init.body as string) as { content: string }
      const response = onPost(content)
      if (response.ok) history.unshift(exchange(history.length + 1, content))
      return Promise.resolve(response)
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
  beforeEach(() => {
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the stored history', async () => {
    mockApi([exchange(1, 'What is MCP?')], () => jsonResponse({}, 201))

    renderApp()

    expect(await screen.findByText('What is MCP?')).toBeInTheDocument()
    expect(screen.getByText('Reply to What is MCP?')).toBeInTheDocument()
  })

  it('sends a message, clears the form and shows the reply', async () => {
    const user = userEvent.setup()
    mockApi([], (content) => jsonResponse(exchange(1, content), 201))
    renderApp()
    expect(await screen.findByText(/No messages yet/)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Message'), 'Hello Claude')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('Reply to Hello Claude')).toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toHaveValue('')
  })

  it('does not send an empty message', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi([], () => jsonResponse({}, 201))
    renderApp()

    await user.click(await screen.findByRole('button', { name: 'Send' }))

    expect(await screen.findByText('Write a message first.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('shows the API error and keeps the text for a retry', async () => {
    const user = userEvent.setup()
    mockApi([], () => jsonResponse({ detail: 'Claude declined to answer this message' }, 422))
    renderApp()

    await user.type(await screen.findByLabelText('Message'), 'Something')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Claude declined to answer this message',
    )
    expect(screen.getByLabelText('Message')).toHaveValue('Something')
  })

  it('explains when Claude is unavailable', async () => {
    const user = userEvent.setup()
    mockApi([], () => jsonResponse({ detail: 'The Claude API returned an error' }, 503))
    renderApp()

    await user.type(await screen.findByLabelText('Message'), 'Something')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Claude is not available right now')
  })
})
