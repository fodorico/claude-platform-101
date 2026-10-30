import { X } from 'lucide-react'
import { useId, type ReactNode } from 'react'

interface DialogProps {
  title: string
  onClose: () => void
  children: ReactNode
  /** Tailwind max-width class; dialogs default to a small one. */
  size?: string
}

/** A modal dialog: closes with Escape, the close button or a click outside it. */
export function Dialog({ title, onClose, children, size = 'max-w-lg' }: DialogProps) {
  const titleId = useId()
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`flex max-h-[90vh] w-full ${size} flex-col rounded-box bg-base-100 shadow-xl`}
        onClick={(event) => {
          event.stopPropagation()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            // Only the dialog closes, not a panel it was opened from.
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="flex items-center gap-2 border-b border-base-300 px-5 py-3">
          <h2 id={titleId} className="flex-1 text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            className="btn btn-ghost btn-square btn-sm"
            aria-label="Close"
            autoFocus
            onClick={onClose}
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}
