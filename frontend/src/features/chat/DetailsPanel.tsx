import { useGetModelSettings } from '../../api/generated/api'
import type { ExchangeRead } from '../../api/generated/model'
import { PROVIDER_LABELS } from '../models/modelChoice'
import { SidePanel } from '../panels/SidePanel'
import { formatDuration } from './format'

interface DetailsPanelProps {
  exchange: ExchangeRead | null
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

/** What the API did for one answer, plus how the API calls the model. */
export function DetailsPanel({ exchange, isStreaming, onClose }: DetailsPanelProps) {
  const settings = useGetModelSettings()

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
                <Row
                  label="Provider"
                  value={PROVIDER_LABELS[exchange.provider] ?? exchange.provider}
                />
                <Row label="Model" value={exchange.model} mono />
                <Row label="Stop reason" value={exchange.stop_reason} mono />
              </dl>
            </>
          )}
        </section>

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
    </SidePanel>
  )
}
