import { Keyboard } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { usePanels } from '../features/panels/panels'

// Shown with the platform's modifier key, e.g. "Ctrl K" or "⌘ K".
const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = isMac ? '⌘' : 'Ctrl'

const SHORTCUTS = [
  { keys: [MOD, 'K'], action: 'Search chats' },
  { keys: [MOD, 'Shift', 'O'], action: 'New chat' },
  { keys: ['/'], action: 'Write a message' },
  { keys: ['?'], action: 'Show keyboard shortcuts' },
]

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

// The element may appear only after the panel opening it renders.
const focusSoon = (id: string) => {
  setTimeout(() => {
    document.getElementById(id)?.focus()
  })
}

/** App-wide keyboard shortcuts, plus a button and dialog that list them. */
export function Shortcuts() {
  const panels = usePanels()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const titleId = useId()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = isMac ? event.metaKey : event.ctrlKey
      const key = event.key.toLowerCase()
      if (mod && !event.shiftKey && key === 'k') {
        event.preventDefault()
        panels.show('history')
        focusSoon('chat-search')
      } else if (mod && event.shiftKey && key === 'o') {
        event.preventDefault()
        void navigate('/')
        focusSoon('message')
      } else if (!mod && !event.altKey && !isTyping(event.target)) {
        if (event.key === '/') {
          event.preventDefault()
          focusSoon('message')
        } else if (event.key === '?') {
          event.preventDefault()
          setIsOpen(true)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [panels, navigate])

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-square hidden sm:inline-flex"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        onClick={() => {
          setIsOpen(true)
        }}
      >
        <Keyboard aria-hidden className="size-5" />
      </button>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
          onClick={() => {
            setIsOpen(false)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="w-full max-w-sm rounded-box bg-base-100 p-5 shadow-xl"
            onClick={(event) => {
              event.stopPropagation()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                setIsOpen(false)
              }
            }}
          >
            <h2 id={titleId} className="text-lg font-semibold">
              Keyboard shortcuts
            </h2>
            <dl className="mt-4 flex flex-col gap-3 text-sm">
              {SHORTCUTS.map(({ keys, action }) => (
                <div key={action} className="flex items-center justify-between gap-3">
                  <dt>{action}</dt>
                  <dd className="flex gap-1">
                    {keys.map((key) => (
                      <kbd key={key} className="kbd kbd-sm">
                        {key}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                className="btn"
                autoFocus
                onClick={() => {
                  setIsOpen(false)
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
