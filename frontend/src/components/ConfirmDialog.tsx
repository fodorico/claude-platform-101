import { useId } from 'react'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  isPending?: boolean
}

/** A modal asking to confirm a destructive action; Cancel has the focus. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  isPending,
}: ConfirmDialogProps) {
  const titleId = useId()
  const messageId = useId()
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="w-full max-w-sm rounded-box bg-base-100 p-5 shadow-xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            // Only the dialog closes, not a panel it was opened from.
            event.stopPropagation()
            onCancel()
          }
        }}
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <p id={messageId} className="mt-2 text-sm text-base-content/80">
          {message}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" autoFocus onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-error" disabled={isPending} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
