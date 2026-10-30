import type { ExchangeRead, ModelPrice } from '../../api/generated/model'

/** The price of the longest prefix of `model` in the list, or null when there is none. */
export function priceFor(model: string, prices: ModelPrice[]): ModelPrice | null {
  let best: ModelPrice | null = null
  for (const price of prices) {
    if (model.startsWith(price.model) && price.model.length > (best?.model.length ?? -1)) {
      best = price
    }
  }
  return best
}

/** Estimated USD cost of one answer at list prices; null when the model has no price.
 * Input tokens include cache reads and writes on Gemini, but not on Claude. */
export function exchangeCost(exchange: ExchangeRead, prices: ModelPrice[]): number | null {
  const price = priceFor(exchange.model, prices)
  if (!price) return null
  const cacheRead = exchange.cache_read_tokens
  const cacheWrite = exchange.cache_write_tokens
  const uncached =
    exchange.provider === 'gemini'
      ? Math.max(exchange.input_tokens - cacheRead, 0)
      : exchange.input_tokens
  return (
    (uncached * price.input +
      cacheRead * price.cache_read +
      cacheWrite * price.cache_write +
      exchange.output_tokens * price.output) /
    1_000_000
  )
}

/** "$0.0123", "<$0.0001" or an em dash when unknown. */
export function formatCost(usd: number | null): string {
  if (usd === null) return '—'
  if (usd > 0 && usd < 0.0001) return '<$0.0001'
  return `$${usd.toFixed(usd < 1 ? 4 : 2)}`
}
