import type { ExchangeRead, ModelPrice } from '../../api/generated/model'
import { exchangeCost } from '../models/cost'

interface Totals {
  messages: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  /** Null while no answer of the chat had its time measured. */
  durationMs: number | null
  /** Estimated USD; null while no answer's model has a price. */
  cost: number | null
}

const noTotals: Totals = {
  messages: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  durationMs: null,
  cost: null,
}

function addUp(totals: Totals, exchange: ExchangeRead, prices: ModelPrice[]): Totals {
  const cost = exchangeCost(exchange, prices)
  return {
    messages: totals.messages + 1,
    cacheReadTokens: totals.cacheReadTokens + exchange.cache_read_tokens,
    cost: cost === null ? totals.cost : (totals.cost ?? 0) + cost,
    inputTokens: totals.inputTokens + exchange.input_tokens,
    outputTokens: totals.outputTokens + exchange.output_tokens,
    durationMs:
      exchange.duration_ms === null
        ? totals.durationMs
        : (totals.durationMs ?? 0) + exchange.duration_ms,
  }
}

/** The chat's totals (every answer, versions included, as each was billed), overall and per
 * model in the order the models were first used. */
export function chatTotals(exchanges: ExchangeRead[], prices: ModelPrice[] = []) {
  const byModel = new Map<string, Totals>()
  let total = noTotals
  for (const exchange of exchanges) {
    byModel.set(exchange.model, addUp(byModel.get(exchange.model) ?? noTotals, exchange, prices))
    total = addUp(total, exchange, prices)
  }
  return { total, byModel: [...byModel] }
}
