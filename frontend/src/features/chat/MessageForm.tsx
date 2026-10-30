import { zodResolver } from '@hookform/resolvers/zod'
import { Pencil, SendHorizontal, Square, X } from 'lucide-react'
import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'

// Mirrors the backend limits in MessageCreate (app/schemas.py).
export const MAX_MESSAGE_LENGTH = 10_000
const SHOW_COUNTER_FROM = MAX_MESSAGE_LENGTH * 0.8

const messageSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'Write a message first.')
    .max(
      MAX_MESSAGE_LENGTH,
      `Keep it under ${MAX_MESSAGE_LENGTH.toLocaleString('en')} characters.`,
    ),
})

type MessageFormValues = z.infer<typeof messageSchema>

interface MessageFormProps {
  /** Resolves when the message was sent; the form is cleared only then. */
  onSend: (content: string) => Promise<unknown>
  isSending: boolean
  /** Stops the answer being written. */
  onStop: () => void
  /** The message being edited, put in the box; null when writing a new one. */
  editing: string | null
  onCancelEdit: () => void
}

export function MessageForm({
  onSend,
  isSending,
  onStop,
  editing,
  onCancelEdit,
}: MessageFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    setFocus,
    control,
    formState: { errors },
  } = useForm<MessageFormValues>({
    resolver: zodResolver(messageSchema),
    defaultValues: { content: '' },
  })
  const length = useWatch({ control, name: 'content' }).length

  useEffect(() => {
    if (editing === null) return
    setValue('content', editing)
    setFocus('content')
  }, [editing, setValue, setFocus])

  const submit = handleSubmit(async ({ content }) => {
    try {
      await onSend(content)
      reset()
    } catch {
      // The parent shows the error; keep the text so the user can retry.
    }
  })

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      {editing !== null && (
        <div className="mb-2 flex items-center gap-2 px-2 text-sm">
          <Pencil aria-hidden className="size-4" />
          <span className="flex-1">Editing your last message</span>
          <button
            type="button"
            className="btn btn-ghost btn-xs gap-1"
            onClick={() => {
              reset()
              onCancelEdit()
            }}
          >
            <X aria-hidden className="size-3" />
            Cancel
          </button>
        </div>
      )}
      <label className="sr-only" htmlFor="message">
        Message
      </label>
      <div
        className={`flex items-end gap-2 rounded-2xl border bg-base-100 p-2 shadow-sm transition focus-within:border-primary ${
          errors.content ? 'border-error' : 'border-base-300'
        }`}
      >
        <textarea
          id="message"
          className="field-sizing-content max-h-48 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 outline-none"
          rows={1}
          placeholder="Ask anything…"
          disabled={isSending}
          aria-invalid={errors.content ? true : undefined}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submit()
            }
          }}
          {...register('content')}
        />
        {isSending ? (
          <button
            type="button"
            className="btn btn-circle btn-neutral"
            aria-label="Stop answering"
            onClick={onStop}
          >
            <Square aria-hidden className="size-4 fill-current" />
          </button>
        ) : (
          <button type="submit" className="btn btn-primary btn-circle" aria-label="Send">
            <SendHorizontal aria-hidden className="size-5" />
          </button>
        )}
      </div>
      <div className="mt-1 flex justify-between gap-2 px-2 text-xs">
        {errors.content ? (
          <span className="text-error">{errors.content.message}</span>
        ) : (
          <span className="hidden text-base-content/80 sm:inline">
            Enter to send · Shift+Enter for a new line
          </span>
        )}
        {length >= SHOW_COUNTER_FROM && (
          <span className={length > MAX_MESSAGE_LENGTH ? 'text-error' : 'text-base-content/80'}>
            {length.toLocaleString('en')} / {MAX_MESSAGE_LENGTH.toLocaleString('en')}
          </span>
        )}
      </div>
    </form>
  )
}
