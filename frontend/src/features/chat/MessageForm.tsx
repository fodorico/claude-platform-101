import { zodResolver } from '@hookform/resolvers/zod'
import { SendHorizontal } from 'lucide-react'
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
}

export function MessageForm({ onSend, isSending }: MessageFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<MessageFormValues>({
    resolver: zodResolver(messageSchema),
    defaultValues: { content: '' },
  })
  const length = useWatch({ control, name: 'content' }).length

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
          placeholder="Ask anything… (Enter to send, Shift+Enter for a new line)"
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
        <button
          type="submit"
          className="btn btn-primary btn-circle"
          disabled={isSending}
          aria-label={isSending ? 'Sending' : 'Send'}
        >
          {isSending ? (
            <span className="loading loading-spinner loading-sm" aria-hidden />
          ) : (
            <SendHorizontal aria-hidden className="size-5" />
          )}
        </button>
      </div>
      <div className="mt-1 flex justify-between px-2 text-xs">
        <span className="text-error">{errors.content?.message}</span>
        {length >= SHOW_COUNTER_FROM && (
          <span className={length > MAX_MESSAGE_LENGTH ? 'text-error' : 'text-base-content/50'}>
            {length.toLocaleString('en')} / {MAX_MESSAGE_LENGTH.toLocaleString('en')}
          </span>
        )}
      </div>
    </form>
  )
}
