import { Archive, ArchiveRestore, Ellipsis, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { ConversationRead } from '../../api/generated/model'

interface ChatRowProps {
  conversation: ConversationRead
  isCurrent: boolean
  /** In selection mode the row is a checkbox instead of a link to the chat. */
  isSelecting: boolean
  isSelected: boolean
  isMenuOpen: boolean
  onOpen: () => void
  onToggleSelected: () => void
  onToggleMenu: () => void
  onRename: (title: string) => void
  onArchive: () => void
  onDelete: () => void
}

export function ChatRow({
  conversation,
  isCurrent,
  isSelecting,
  isSelected,
  isMenuOpen,
  onOpen,
  onToggleSelected,
  onToggleMenu,
  onRename,
  onArchive,
  onDelete,
}: ChatRowProps) {
  const [isRenaming, setIsRenaming] = useState(false)
  const isArchived = conversation.archived_at !== null
  const rowClass = `rounded-lg text-sm ${isCurrent ? 'bg-base-200 font-medium' : ''}`

  if (isSelecting) {
    return (
      <label className={`flex cursor-pointer items-center gap-3 px-2 py-2.5 ${rowClass}`}>
        <input
          type="checkbox"
          className="checkbox checkbox-primary checkbox-sm"
          checked={isSelected}
          onChange={onToggleSelected}
        />
        <span className="truncate">{conversation.title}</span>
      </label>
    )
  }

  if (isRenaming) {
    const finish = (value: string) => {
      setIsRenaming(false)
      const title = value.trim()
      if (title && title !== conversation.title) onRename(title)
    }
    return (
      <input
        aria-label="Chat title"
        className="input input-sm w-full"
        defaultValue={conversation.title}
        maxLength={200}
        autoFocus
        onFocus={(event) => {
          event.target.select()
        }}
        onBlur={(event) => {
          finish(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') finish(event.currentTarget.value)
          if (event.key === 'Escape') {
            // Escape only cancels the rename, not the panel around it.
            event.stopPropagation()
            // Restore the title so a blur while closing doesn't save the edit.
            event.currentTarget.value = conversation.title
            setIsRenaming(false)
          }
        }}
      />
    )
  }

  const menuItem = 'btn btn-ghost btn-sm w-full justify-start gap-2 font-normal'
  return (
    <div>
      <div className={`group flex items-center hover:bg-base-200 ${rowClass}`}>
        <button
          type="button"
          aria-current={isCurrent ? 'page' : undefined}
          className="min-w-0 flex-1 truncate px-2 py-2.5 text-left"
          onClick={onOpen}
        >
          {conversation.title}
        </button>
        <button
          type="button"
          aria-label={`Options for ${conversation.title}`}
          aria-expanded={isMenuOpen}
          className="btn btn-ghost btn-square btn-sm"
          onClick={onToggleMenu}
        >
          <Ellipsis aria-hidden className="size-4" />
        </button>
      </div>
      {isMenuOpen && (
        <div className="mx-2 mb-1 flex flex-col rounded-box border border-base-300 bg-base-100 p-1 shadow">
          <button
            type="button"
            className={menuItem}
            onClick={() => {
              onToggleMenu()
              setIsRenaming(true)
            }}
          >
            <Pencil aria-hidden className="size-4" />
            Rename
          </button>
          <button type="button" className={menuItem} onClick={onArchive}>
            {isArchived ? (
              <ArchiveRestore aria-hidden className="size-4" />
            ) : (
              <Archive aria-hidden className="size-4" />
            )}
            {isArchived ? 'Unarchive' : 'Archive'}
          </button>
          <button type="button" className={menuItem} onClick={onDelete}>
            <Trash2 aria-hidden className="size-4 text-error" />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
