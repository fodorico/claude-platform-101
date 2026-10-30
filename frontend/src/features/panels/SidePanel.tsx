import { X } from 'lucide-react'
import type { ReactNode } from 'react'

interface SidePanelProps {
  side: 'left' | 'right'
  title: string
  onClose: () => void
  children: ReactNode
}

/** A column beside the chat on large screens; a drawer over it on small ones. */
export function SidePanel({ side, title, onClose, children }: SidePanelProps) {
  const isLeft = side === 'left'
  return (
    <>
      {/* Tapping outside the drawer closes it; the close button is the accessible way. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        className="fixed inset-0 z-30 cursor-default bg-black/60 lg:hidden"
        onClick={onClose}
      />
      <aside
        aria-label={title}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
        className={`fixed inset-y-0 z-40 flex w-80 max-w-[85vw] flex-col bg-base-100 shadow-xl lg:static lg:z-auto lg:w-72 lg:max-w-none lg:shrink-0 lg:shadow-none xl:w-80 ${
          isLeft ? 'left-0 lg:border-r' : 'right-0 lg:border-l'
        } border-base-300`}
      >
        <div className="flex items-center gap-2 px-4 pt-3 pb-1">
          <h2 className="flex-1 font-semibold">{title}</h2>
          <button
            type="button"
            className="btn btn-ghost btn-square btn-sm"
            aria-label={`Close ${title.toLowerCase()}`}
            onClick={onClose}
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">{children}</div>
      </aside>
    </>
  )
}
