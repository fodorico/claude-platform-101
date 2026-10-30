import type { ExchangeRead } from '../../api/generated/model'

interface Totals {
  messages: number
  inputTokens: number
  outputTokens: number
  /** Null while no answer of the chat had its time measured. */
  durationMs: number | null
}

const noTotals: Totals = { messages: 0, inputTokens: 0, outputTokens: 0, durationMs: null }

function addUp(totals: Totals, exchange: ExchangeRead): Totals {
  return {
    messages: totals.messages + 1,
    inputTokens: totals.inputTokens + exchange.input_tokens,
    outputTokens: totals.outputTokens + exchange.output_tokens,
    durationMs:
      exchange.duration_ms === null
        ? totals.durationMs
        : (totals.durationMs ?? 0) + exchange.duration_ms,
  }
}

/** The chat's totals, overall and per model, in the order the models were first used. */
export function chatTotals(exchanges: ExchangeRead[]) {
  const byModel = new Map<string, Totals>()
  for (const exchange of exchanges) {
    byModel.set(exchange.model, addUp(byModel.get(exchange.model) ?? noTotals, exchange))
  }
  return { total: exchanges.reduce(addUp, noTotals), byModel: [...byModel] }
}
