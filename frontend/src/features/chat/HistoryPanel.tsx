import { useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, SquarePen, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { errorMessage } from '../../api/errors'
import {
  getListConversationMessagesQueryKey,
  useBulkUpdateConversations,
  useListConversations,
  useUpdateConversation,
} from '../../api/generated/api'
import type { ConversationBulkActionAction, ConversationRead } from '../../api/generated/model'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { SidePanel } from '../panels/SidePanel'
import { ChatRow } from './ChatRow'
import { dayLabel } from './format'

interface HistoryPanelProps {
  currentId: number | null
  /** Open a conversation; null starts a new one. */
  onOpen: (id: number | null) => void
  /** Called with the ids of deleted conversations (e.g. to leave one that is open). */
  onDeleted: (ids: number[]) => void
  onClose: () => void
}

// Every list of conversations (active and archived) shares this key prefix.
const CONVERSATIONS_KEY = ['/api/conversations']

function groupByDay(conversations: ConversationRead[]) {
  const groups = new Map<string, ConversationRead[]>()
  for (const conversation of conversations) {
    const label = dayLabel(new Date(conversation.updated_at))
    groups.set(label, [...(groups.get(label) ?? []), conversation])
  }
  return [...groups]
}

export function HistoryPanel({ currentId, onOpen, onDeleted, onClose }: HistoryPanelProps) {
  const queryClient = useQueryClient()
  const [showArchived, setShowArchived] = useState(false)
  const [isSelecting, setIsSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [menuId, setMenuId] = useState<number | null>(null)
  const [toDelete, setToDelete] = useState<number[] | null>(null)

  const conversations = useListConversations({ archived: showArchived })
  const list = conversations.data ?? []

  const refresh = () => queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY })
  const update = useUpdateConversation({ mutation: { onSuccess: refresh } })
  const bulk = useBulkUpdateConversations()
  const error = update.error ?? bulk.error

  const stopSelecting = () => {
    setIsSelecting(false)
    setSelected(new Set())
  }

  const runBulk = (ids: number[], action: ConversationBulkActionAction) => {
    bulk.mutate(
      { data: { ids, action } },
      {
        onSuccess: () => {
          if (action === 'delete') {
            for (const id of ids) {
              queryClient.removeQueries({ queryKey: getListConversationMessagesQueryKey(id) })
            }
            onDeleted(ids)
          }
          setToDelete(null)
          stopSelecting()
          void refresh()
        },
      },
    )
  }

  const switchList = (archived: boolean) => {
    setShowArchived(archived)
    setMenuId(null)
    stopSelecting()
  }

  const allSelected = list.length > 0 && selected.size === list.length
  const tab = (active: boolean) =>
    `btn btn-sm join-item flex-1 ${active ? 'btn-active btn-neutral' : 'btn-ghost'}`

  return (
    <SidePanel side="left" title="History" onClose={onClose}>
      <div className="flex flex-col gap-2 px-2 pt-1 pb-2">
        <button
          type="button"
          className="btn btn-outline btn-sm justify-start gap-2"
          onClick={() => {
            onOpen(null)
          }}
        >
          <SquarePen aria-hidden className="size-4" />
          New chat
        </button>
        <div className="flex items-center gap-2">
          <div className="join flex-1">
            <button
              type="button"
              className={tab(!showArchived)}
              aria-pressed={!showArchived}
              onClick={() => {
                switchList(false)
              }}
            >
              Chats
            </button>
            <button
              type="button"
              className={tab(showArchived)}
              aria-pressed={showArchived}
              onClick={() => {
                switchList(true)
              }}
            >
              Archived
            </button>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={list.length === 0 && !isSelecting}
            onClick={() => {
              if (isSelecting) stopSelecting()
              else {
                setIsSelecting(true)
                setMenuId(null)
              }
            }}
          >
            {isSelecting ? 'Done' : 'Select'}
          </button>
        </div>
        {isSelecting && (
          <label className="flex items-center gap-3 px-2 text-sm">
            <input
              type="checkbox"
              className="checkbox checkbox-primary checkbox-sm"
              checked={allSelected}
              onChange={() => {
                setSelected(allSelected ? new Set() : new Set(list.map((item) => item.id)))
              }}
            />
            Select all
          </label>
        )}
        {error !== null && (
          <p role="alert" className="text-sm text-error">
            {errorMessage(error)}
          </p>
        )}
      </div>

      {conversations.isSuccess && list.length === 0 && (
        <p className="px-2 py-4 text-sm text-base-content/80">
          {showArchived ? 'No archived chats.' : 'Your chats will appear here.'}
        </p>
      )}
      {groupByDay(list).map(([label, items]) => (
        <section key={label} aria-label={label} className="mt-2">
          <h3 className="px-2 py-1 text-xs font-semibold text-base-content/80">{label}</h3>
          <ul className="flex flex-col gap-0.5">
            {items.map((conversation) => (
              <li key={conversation.id}>
                <ChatRow
                  conversation={conversation}
                  isCurrent={conversation.id === currentId}
                  isSelecting={isSelecting}
                  isSelected={selected.has(conversation.id)}
                  isMenuOpen={menuId === conversation.id}
                  onOpen={() => {
                    onOpen(conversation.id)
                  }}
                  onToggleSelected={() => {
                    const next = new Set(selected)
                    if (!next.delete(conversation.id)) next.add(conversation.id)
                    setSelected(next)
                  }}
                  onToggleMenu={() => {
                    setMenuId(menuId === conversation.id ? null : conversation.id)
                  }}
                  onRename={(title) => {
                    update.mutate({ conversationId: conversation.id, data: { title } })
                  }}
                  onArchive={() => {
                    setMenuId(null)
                    update.mutate({
                      conversationId: conversation.id,
                      data: { archived: conversation.archived_at === null },
                    })
                  }}
                  onDelete={() => {
                    setMenuId(null)
                    setToDelete([conversation.id])
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {isSelecting && (
        <div className="sticky bottom-0 mt-2 flex flex-wrap items-center gap-2 border-t border-base-300 bg-base-100 px-2 pt-3">
          <span className="flex-1 text-sm">{selected.size} selected</span>
          <button
            type="button"
            className="btn btn-sm gap-2"
            disabled={selected.size === 0 || bulk.isPending}
            onClick={() => {
              runBulk([...selected], showArchived ? 'unarchive' : 'archive')
            }}
          >
            {showArchived ? (
              <ArchiveRestore aria-hidden className="size-4" />
            ) : (
              <Archive aria-hidden className="size-4" />
            )}
            {showArchived ? 'Unarchive' : 'Archive'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-error gap-2"
            disabled={selected.size === 0 || bulk.isPending}
            onClick={() => {
              setToDelete([...selected])
            }}
          >
            <Trash2 aria-hidden className="size-4" />
            Delete
          </button>
        </div>
      )}

      {toDelete && (
        <ConfirmDialog
          title={
            toDelete.length === 1 ? 'Delete this chat?' : `Delete ${String(toDelete.length)} chats?`
          }
          message="Their messages are deleted too. This can't be undone."
          confirmLabel="Delete"
          isPending={bulk.isPending}
          onConfirm={() => {
            runBulk(toDelete, 'delete')
          }}
          onCancel={() => {
            setToDelete(null)
          }}
        />
      )}
    </SidePanel>
  )
}
