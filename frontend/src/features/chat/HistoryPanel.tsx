import type { ExchangeRead } from '../../api/generated/model'
import { SidePanel } from '../panels/SidePanel'
import { dayLabel } from './format'

interface HistoryPanelProps {
  /** Newest first, as the API returns them. */
  exchanges: ExchangeRead[]
  selectedId: number | null
  onSelect: (id: number) => void
  onClose: () => void
}

export function HistoryPanel({ exchanges, selectedId, onSelect, onClose }: HistoryPanelProps) {
  const groups = new Map<string, ExchangeRead[]>()
  for (const exchange of exchanges) {
    const label = dayLabel(new Date(exchange.created_at))
    groups.set(label, [...(groups.get(label) ?? []), exchange])
  }

  return (
    <SidePanel side="left" title="History" onClose={onClose}>
      {exchanges.length === 0 && (
        <p className="px-2 py-4 text-sm text-base-content/80">Your questions will appear here.</p>
      )}
      {[...groups].map(([label, items]) => (
        <section key={label} aria-label={label} className="mt-2">
          <h3 className="px-2 py-1 text-xs font-semibold text-base-content/80">{label}</h3>
          <ul className="flex flex-col gap-0.5">
            {items.map((exchange) => (
              <li key={exchange.id}>
                <button
                  type="button"
                  aria-current={exchange.id === selectedId ? 'true' : undefined}
                  className={`w-full truncate rounded-lg px-2 py-2.5 text-left text-sm hover:bg-base-200 ${
                    exchange.id === selectedId ? 'bg-base-200 font-medium' : ''
                  }`}
                  onClick={() => {
                    onSelect(exchange.id)
                  }}
                >
                  {exchange.prompt}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </SidePanel>
  )
}
