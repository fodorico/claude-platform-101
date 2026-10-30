import { describe, expect, it } from 'vitest'
import type { ExchangeRead } from '../../api/generated/model'
import { chatTotals } from './chatTotals'

const exchange = (model: string, durationMs: number | null): ExchangeRead => ({
  id: 1,
  conversation_id: 1,
  prompt: 'Hi',
  reply: 'Hello',
  provider: 'gemini',
  model,
  stop_reason: 'STOP',
  input_tokens: 10,
  output_tokens: 20,
  duration_ms: durationMs,
  first_token_ms: null,
  created_at: '2026-10-29T12:00:00Z',
  thinking: null,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  rating: null,
  version_group: 1,
  is_active: true,
  attachments: [],
})

describe('chatTotals', () => {
  it('adds up the chat and splits it by model in order of first use', () => {
    const { total, byModel } = chatTotals([
      exchange('b', 1000),
      exchange('a', null),
      exchange('b', 500),
    ])

    expect(total).toEqual({
      messages: 3,
      inputTokens: 30,
      outputTokens: 60,
      cacheReadTokens: 0,
      durationMs: 1500,
      // No prices given: no estimate.
      cost: null,
    })
    expect(byModel.map(([model, usage]) => [model, usage.messages])).toEqual([
      ['b', 2],
      ['a', 1],
    ])
  })

  it('has no total time when no answer was timed', () => {
    expect(chatTotals([exchange('a', null)]).total.durationMs).toBeNull()
  })
})
