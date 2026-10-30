import { SquarePen } from 'lucide-react'
import type { ConversationRead } from '../../api/generated/model'
import { SidePanel } from '../panels/SidePanel'
import { dayLabel } from './format'

interface HistoryPanelProps {
  /** Latest activity first, as the API returns them. */
  conversations: ConversationRead[]
  currentId: number | null
  /** Open a conversation; null starts a new one. */
  onOpen: (id: number | null) => void
  onClose: () => void
}

export function HistoryPanel({ conversations, currentId, onOpen, onClose }: HistoryPanelProps) {
  const groups = new Map<string, ConversationRead[]>()
  for (const conversation of conversations) {
    const label = dayLabel(new Date(conversation.updated_at))
    groups.set(label, [...(groups.get(label) ?? []), conversation])
  }

  return (
    <SidePanel side="left" title="History" onClose={onClose}>
      <button
        type="button"
        className="btn btn-outline btn-sm mx-2 mt-1 mb-2 w-[calc(100%-1rem)] justify-start gap-2"
        onClick={() => {
          onOpen(null)
        }}
      >
        <SquarePen aria-hidden className="size-4" />
        New chat
      </button>
      {conversations.length === 0 && (
        <p className="px-2 py-4 text-sm text-base-content/80">Your chats will appear here.</p>
      )}
      {[...groups].map(([label, items]) => (
        <section key={label} aria-label={label} className="mt-2">
          <h3 className="px-2 py-1 text-xs font-semibold text-base-content/80">{label}</h3>
          <ul className="flex flex-col gap-0.5">
            {items.map((conversation) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  aria-current={conversation.id === currentId ? 'page' : undefined}
                  className={`w-full truncate rounded-lg px-2 py-2.5 text-left text-sm hover:bg-base-200 ${
                    conversation.id === currentId ? 'bg-base-200 font-medium' : ''
                  }`}
                  onClick={() => {
                    onOpen(conversation.id)
                  }}
                >
                  {conversation.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </SidePanel>
  )
}
