import type { ExchangeRead } from '../../api/generated/model'
import { Dialog } from '../../components/Dialog'
import { modelLabel } from '../models/modelLabel'
import { formatDuration } from './format'
import { Markdown } from './Markdown'

/** Every version of a message side by side, to compare models or prompts. */
export function CompareDialog({
  versions,
  onClose,
}: {
  versions: ExchangeRead[]
  onClose: () => void
}) {
  return (
    <Dialog title="Compare versions" onClose={onClose} size="max-w-6xl">
      <div className="grid gap-4 md:grid-flow-col md:auto-cols-fr">
        {versions.map((version, index) => (
          <article
            key={version.id}
            aria-label={`Version ${String(index + 1)}`}
            className={`flex min-w-0 flex-col gap-2 rounded-box border p-3 ${
              version.is_active ? 'border-primary' : 'border-base-300'
            }`}
          >
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold">
                {index + 1}. {modelLabel(version.model)}
              </h3>
              {version.is_active && <span className="badge badge-primary badge-sm">In chat</span>}
            </header>
            <p className="text-xs text-base-content/80">
              {[
                formatDuration(version.duration_ms),
                `${String(version.input_tokens)} in / ${String(version.output_tokens)} out`,
              ].join(' · ')}
            </p>
            <p className="rounded-box bg-base-200 px-3 py-2 text-sm whitespace-pre-wrap">
              {version.prompt}
            </p>
            <div className="min-w-0 text-sm">
              <Markdown>{version.reply}</Markdown>
            </div>
          </article>
        ))}
      </div>
    </Dialog>
  )
}
