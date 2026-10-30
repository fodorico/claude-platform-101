import { zodResolver } from '@hookform/resolvers/zod'
import { Send } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

// Mirrors the backend limits in MessageCreate (app/schemas.py).
export const MAX_MESSAGE_LENGTH = 10_000

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
    formState: { errors },
  } = useForm<MessageFormValues>({
    resolver: zodResolver(messageSchema),
    defaultValues: { content: '' },
  })

  const submit = handleSubmit(async ({ content }) => {
    try {
      await onSend(content)
      reset()
    } catch {
      // The parent shows the error; keep the text so the user can retry.
    }
  })

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2" noValidate>
      <label className="sr-only" htmlFor="message">
        Message
      </label>
      <textarea
        id="message"
        className={`textarea w-full ${errors.content ? 'textarea-error' : ''}`}
        rows={3}
        placeholder="Ask Claude something…"
        disabled={isSending}
        aria-invalid={errors.content ? true : undefined}
        {...register('content')}
      />
      {errors.content && <p className="text-sm text-error">{errors.content.message}</p>}
      <button type="submit" className="btn btn-primary self-end" disabled={isSending}>
        {isSending ? (
          <span className="loading loading-spinner loading-sm" aria-hidden />
        ) : (
          <Send aria-hidden className="size-4" />
        )}
        {isSending ? 'Sending…' : 'Send'}
      </button>
    </form>
  )
}
