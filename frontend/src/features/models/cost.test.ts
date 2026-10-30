import { describe, expect, it } from 'vitest'
import type { ExchangeRead, ModelPrice } from '../../api/generated/model'
import { exchangeCost, formatCost, priceFor } from './cost'

const prices: ModelPrice[] = [
  { model: 'gemini-3.5-flash', input: 1, output: 10, cache_read: 0.1, cache_write: 0 },
  { model: 'gemini-3.5-flash-lite', input: 0.3, output: 2.5, cache_read: 0.03, cache_write: 0 },
  { model: 'claude-opus-5-5', input: 4, output: 20, cache_read: 0.2, cache_write: 5 },
]

const usage = (provider: string, model: string): ExchangeRead =>
  ({
    provider,
    model,
    input_tokens: 1_000_000,
    output_tokens: 100_000,
    cache_read_tokens: 500_000,
    cache_write_tokens: 200_000,
  }) as ExchangeRead

describe('cost estimates', () => {
  it('picks the longest matching prefix', () => {
    expect(priceFor('gemini-3.5-flash-lite-001', prices)?.model).toBe('gemini-3.5-flash-lite')
    expect(priceFor('gemini-3.5-flash', prices)?.model).toBe('gemini-3.5-flash')
    expect(priceFor('gpt-x', prices)).toBeNull()
  })

  it('bills Claude cache reads and writes on top of the input tokens', () => {
    // 1M input × $4 + 0.5M reads × $0.2 + 0.2M writes × $5 + 0.1M output × $20.
    expect(exchangeCost(usage('claude', 'claude-opus-5-5'), prices)).toBeCloseTo(4 + 0.1 + 1 + 2)
  })

  it('takes Gemini cache reads out of the input tokens', () => {
    // 0.5M uncached × $0.3 + 0.5M reads × $0.03 + 0.1M output × $2.5.
    expect(exchangeCost(usage('gemini', 'gemini-3.5-flash-lite'), prices)).toBeCloseTo(
      0.15 + 0.015 + 0.25,
    )
  })

  it('formats small, regular and unknown costs', () => {
    expect(formatCost(0.00001)).toBe('<$0.0001')
    expect(formatCost(0.0123)).toBe('$0.0123')
    expect(formatCost(3.5)).toBe('$3.50')
    expect(formatCost(null)).toBe('—')
  })
})
