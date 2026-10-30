import { Braces } from 'lucide-react'
import { useState } from 'react'
import { useGetModelSettings } from '../../api/generated/api'
import type { ExchangeRead } from '../../api/generated/model'
import { exchangeCost, formatCost } from '../models/cost'
import { PROVIDER_LABELS } from '../models/modelChoice'
import { modelLabel } from '../models/modelLabel'
import { SidePanel } from '../panels/SidePanel'
import { ApiCallDialog } from './ApiCallDialog'
import { chatTotals } from './chatTotals'
import { formatDuration } from './format'

interface DetailsPanelProps {
  exchange: ExchangeRead | null
  /** Every stored exchange of the open chat, for its totals. */
  exchanges: ExchangeRead[]
  isStreaming: boolean
  onClose: () => void
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-box bg-base-200 p-3">
      <dt className="text-xs text-base-content/80">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-base-content/80">{label}</dt>
      <dd className={`min-w-0 truncate text-right ${mono ? 'font-mono text-xs leading-5' : ''}`}>
        {value}
      </dd>
    </div>
  )
}

const count = (value: number) => value.toLocaleString('en')

/** What the API did for one answer and for the whole chat, plus how it calls the model. */
export function DetailsPanel({ exchange, exchanges, isStreaming, onClose }: DetailsPanelProps) {
  const settings = useGetModelSettings()
  const prices = settings.data?.prices ?? []
  const totals = chatTotals(exchanges, prices)
  const [inspecting, setInspecting] = useState<number | null>(null)

  return (
    <SidePanel side="right" title="Request details" onClose={onClose}>
      <div className="flex flex-col gap-6 px-2 pt-2">
        <section aria-label="Answer" className="flex flex-col gap-3">
          {isStreaming && <p className="text-sm text-base-content/80">Answering…</p>}
          {!isStreaming && exchange === null && (
            <p className="text-sm text-base-content/80">Select an answer to see its details.</p>
          )}
          {!isStreaming && exchange !== null && (
            <>
              <p className="line-clamp-2 text-sm text-base-content/80">“{exchange.prompt}”</p>
              <dl className="grid grid-cols-2 gap-2">
                <Metric label="First token" value={formatDuration(exchange.first_token_ms)} />
                <Metric label="Total time" value={formatDuration(exchange.duration_ms)} />
                <Metric label="Input tokens" value={String(exchange.input_tokens)} />
                <Metric label="Output tokens" value={String(exchange.output_tokens)} />
              </dl>
              <dl className="flex flex-col gap-2 text-sm">
                <Row label="Estimated cost" value={formatCost(exchangeCost(exchange, prices))} />
                <Row label="Cache read" value={`${count(exchange.cache_read_tokens)} tokens`} />
                {exchange.provider === 'claude' && (
                  <Row label="Cache write" value={`${count(exchange.cache_write_tokens)} tokens`} />
                )}
                <Row
                  label="Provider"
                  value={PROVIDER_LABELS[exchange.provider] ?? exchange.provider}
                />
                <Row label="Model" value={exchange.model} mono />
                <Row label="Stop reason" value={exchange.stop_reason} mono />
              </dl>
              <button
                type="button"
                className="btn btn-outline btn-sm gap-2 self-start"
                onClick={() => {
                  setInspecting(exchange.id)
                }}
              >
                <Braces aria-hidden className="size-4" />
                View API call
              </button>
            </>
          )}
        </section>

        {totals.total.messages > 0 && (
          <section aria-labelledby="chat-totals" className="flex flex-col gap-3">
            <h3 id="chat-totals" className="text-sm font-semibold">
              This chat
            </h3>
            <dl className="grid grid-cols-2 gap-2">
              <Metric label="Answers" value={count(totals.total.messages)} />
              <Metric label="Estimated cost" value={formatCost(totals.total.cost)} />
              <Metric label="Total time" value={formatDuration(totals.total.durationMs)} />
              <Metric label="Input tokens" value={count(totals.total.inputTokens)} />
              <Metric label="Output tokens" value={count(totals.total.outputTokens)} />
              <Metric label="Cache read" value={count(totals.total.cacheReadTokens)} />
            </dl>
            {totals.total.cost !== null && (
              <p className="text-xs text-base-content/80">
                Estimated at paid-tier list prices; free tiers cost nothing.
              </p>
            )}
            {totals.byModel.length > 1 && (
              <table className="table table-xs">
                <caption className="sr-only">Usage by model</caption>
                <thead>
                  <tr>
                    <th scope="col">Model</th>
                    <th scope="col" className="text-right">
                      Answers
                    </th>
                    <th scope="col" className="text-right">
                      Tokens in / out
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {totals.byModel.map(([model, usage]) => (
                    <tr key={model}>
                      <td title={model}>{modelLabel(model)}</td>
                      <td className="text-right tabular-nums">{count(usage.messages)}</td>
                      <td className="text-right tabular-nums">
                        {count(usage.inputTokens)} / {count(usage.outputTokens)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        <section aria-labelledby="model-settings" className="flex flex-col gap-3">
          <h3 id="model-settings" className="text-sm font-semibold">
            Model settings
          </h3>
          {settings.isPending && <span className="loading loading-dots" aria-label="Loading" />}
          {settings.isError && (
            <p className="text-sm text-base-content/80">Could not load the model settings.</p>
          )}
          {settings.data && (
            <>
              <dl className="flex flex-col gap-2 text-sm">
                <Row label="Max tokens" value={String(settings.data.max_tokens)} />
              </dl>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-base-content/80">System prompt</span>
                <p className="rounded-box bg-neutral p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-neutral-content">
                  {settings.data.system_prompt}
                </p>
              </div>
            </>
          )}
        </section>
      </div>
      {inspecting !== null && (
        <ApiCallDialog
          exchangeId={inspecting}
          onClose={() => {
            setInspecting(null)
          }}
        />
      )}
    </SidePanel>
  )
}
