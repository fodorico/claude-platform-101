import { useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { errorMessage } from '../../api/errors'
import {
  getListPromptsQueryKey,
  useCreatePrompt,
  useDeletePrompt,
  useListPrompts,
} from '../../api/generated/api'
import { Dialog } from '../../components/Dialog'

interface PromptLibraryProps {
  /** The message box's text, offered as a new prompt. */
  currentText: string
  onInsert: (content: string) => void
  onClose: () => void
}

/** Saved prompts: insert one into the message box, save a new one, or delete one. */
export function PromptLibrary({ currentText, onInsert, onClose }: PromptLibraryProps) {
  const queryClient = useQueryClient()
  const prompts = useListPrompts()
  const refresh = () => queryClient.invalidateQueries({ queryKey: getListPromptsQueryKey() })
  const create = useCreatePrompt({ mutation: { onSuccess: refresh } })
  const remove = useDeletePrompt({ mutation: { onSuccess: refresh } })
  const [isAdding, setIsAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState(currentText)
  const error = create.error ?? remove.error

  return (
    <Dialog title="Prompt library" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {prompts.isPending && <span className="loading loading-dots" aria-label="Loading" />}
        {prompts.isSuccess && prompts.data.length === 0 && !isAdding && (
          <p className="text-sm text-base-content/80">
            Save prompts you use often and insert them with one click.
          </p>
        )}
        {prompts.data && prompts.data.length > 0 && (
          <ul className="flex flex-col gap-1" aria-label="Saved prompts">
            {prompts.data.map((prompt) => (
              <li key={prompt.id} className="flex items-center gap-1 rounded-box hover:bg-base-200">
                <button
                  type="button"
                  className="min-w-0 flex-1 px-3 py-2 text-left"
                  onClick={() => {
                    onInsert(prompt.content)
                    onClose()
                  }}
                >
                  <span className="block truncate text-sm font-medium">{prompt.title}</span>
                  <span className="block truncate text-xs text-base-content/80">
                    {prompt.content}
                  </span>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-square btn-sm"
                  aria-label={`Delete prompt ${prompt.title}`}
                  onClick={() => {
                    remove.mutate({ promptId: prompt.id })
                  }}
                >
                  <Trash2 aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {isAdding ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              create.mutate(
                { data: { title, content } },
                {
                  onSuccess: () => {
                    setIsAdding(false)
                    setTitle('')
                  },
                },
              )
            }}
          >
            <label className="flex flex-col gap-1 text-sm">
              Title
              <input
                className="input input-sm w-full"
                required
                maxLength={100}
                value={title}
                autoFocus
                onChange={(event) => {
                  setTitle(event.target.value)
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Prompt
              <textarea
                className="textarea w-full"
                required
                rows={4}
                maxLength={10_000}
                value={content}
                onChange={(event) => {
                  setContent(event.target.value)
                }}
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setIsAdding(false)
                }}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={create.isPending}>
                Save prompt
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="btn btn-outline btn-sm gap-2 self-start"
            onClick={() => {
              setIsAdding(true)
            }}
          >
            <Plus aria-hidden className="size-4" />
            New prompt
          </button>
        )}
        {error !== null && (
          <p role="alert" className="text-sm text-error">
            {errorMessage(error)}
          </p>
        )}
      </div>
    </Dialog>
  )
}
