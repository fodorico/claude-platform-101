import { zodResolver } from '@hookform/resolvers/zod'
import {
  BookText,
  ImagePlus,
  Mic,
  Pencil,
  SendHorizontal,
  SlidersHorizontal,
  Square,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import type { ImageCreate } from '../../api/generated/model'
import { PromptLibrary } from '../prompts/PromptLibrary'
import { IMAGE_TYPES, MAX_IMAGES, readImages, type PendingImage } from './images'
import { useDictation } from './useDictation'

// Mirrors the backend limits in MessageCreate (app/schemas.py).
export const MAX_MESSAGE_LENGTH = 10_000
const SHOW_COUNTER_FROM = MAX_MESSAGE_LENGTH * 0.8
// Wait for a pause in typing before counting tokens.
const COUNT_DELAY_MS = 700

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
  onSend: (content: string, images: ImageCreate[]) => Promise<unknown>
  isSending: boolean
  /** Stops the answer being written. */
  onStop: () => void
  /** The message being edited, put in the box; null when writing a new one. */
  editing: string | null
  onCancelEdit: () => void
  onOpenSettings: () => void
  /** The chat's settings differ from the defaults. */
  settingsCustomized: boolean
  /** Input tokens the message would use; omitted where counting isn't possible. */
  countTokens?: (content: string, images: ImageCreate[]) => Promise<number>
}

const toolButton = 'btn btn-ghost btn-square btn-sm'

export function MessageForm({
  onSend,
  isSending,
  onStop,
  editing,
  onCancelEdit,
  onOpenSettings,
  settingsCustomized,
  countTokens,
}: MessageFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    getValues,
    setFocus,
    control,
    formState: { errors },
  } = useForm<MessageFormValues>({
    resolver: zodResolver(messageSchema),
    defaultValues: { content: '' },
  })
  const content = useWatch({ control, name: 'content' })
  const length = content.length
  const [images, setImages] = useState<PendingImage[]>([])
  const [imageError, setImageError] = useState<string | null>(null)
  const [promptsOpen, setPromptsOpen] = useState(false)
  const [tokens, setTokens] = useState<number | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const append = (text: string) => {
    const current = getValues('content')
    setValue('content', current ? `${current} ${text}` : text, { shouldValidate: false })
  }
  const dictation = useDictation(append)

  useEffect(() => {
    if (editing === null) return
    setValue('content', editing)
    setFocus('content')
  }, [editing, setValue, setFocus])

  // Count the tokens of what is being written, after a pause in typing.
  useEffect(() => {
    if (!countTokens || !content.trim()) return
    let current = true
    const timer = setTimeout(() => {
      countTokens(content, images)
        .then((count) => {
          if (current) setTokens(count)
        })
        .catch(() => {
          if (current) setTokens(null)
        })
    }, COUNT_DELAY_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [content, images, countTokens])

  const addFiles = (files: File[]) => {
    if (!files.length) return
    readImages(files, images.length)
      .then((read) => {
        setImageError(null)
        setImages((current) => [...current, ...read])
      })
      .catch((error: unknown) => {
        setImageError(error instanceof Error ? error.message : 'Could not attach the image.')
      })
  }

  const submit = handleSubmit(async ({ content }) => {
    try {
      await onSend(
        content,
        images.map(({ media_type, data }) => ({ media_type, data })),
      )
      reset()
      setImages([])
      setTokens(null)
    } catch {
      // The parent shows the error; keep the text so the user can retry.
    }
  })

  const hint = errors.content?.message ?? imageError
  return (
    <>
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
          className={`flex flex-col gap-1 rounded-2xl border bg-base-100 p-2 shadow-sm transition focus-within:border-primary ${
            errors.content ? 'border-error' : 'border-base-300'
          }`}
          onDragOver={(event) => {
            event.preventDefault()
          }}
          onDrop={(event) => {
            event.preventDefault()
            addFiles([...event.dataTransfer.files])
          }}
        >
          {images.length > 0 && (
            <ul className="flex flex-wrap gap-2 px-1 pt-1" aria-label="Attached images">
              {images.map((image, index) => (
                <li key={image.url} className="relative">
                  <img
                    src={image.url}
                    alt={image.name}
                    className="size-16 rounded-box object-cover"
                  />
                  <button
                    type="button"
                    className="btn btn-circle btn-xs absolute -top-2 -right-2"
                    aria-label={`Remove ${image.name}`}
                    onClick={() => {
                      setImages(images.filter((_, i) => i !== index))
                    }}
                  >
                    <X aria-hidden className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <textarea
            id="message"
            className="field-sizing-content max-h-48 min-h-10 resize-none bg-transparent px-2 py-2 outline-none"
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
            onPaste={(event) => {
              const files = [...event.clipboardData.files].filter((file) =>
                file.type.startsWith('image/'),
              )
              if (files.length) {
                event.preventDefault()
                addFiles(files)
              }
            }}
            {...register('content')}
          />
          <div className="flex items-center gap-0.5">
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              accept={IMAGE_TYPES.join(',')}
              multiple
              tabIndex={-1}
              aria-hidden
              onChange={(event) => {
                addFiles([...(event.target.files ?? [])])
                event.target.value = ''
              }}
            />
            <button
              type="button"
              className={toolButton}
              aria-label="Attach images"
              title={`Attach up to ${String(MAX_IMAGES)} images (or paste them)`}
              disabled={isSending || images.length >= MAX_IMAGES}
              onClick={() => fileInput.current?.click()}
            >
              <ImagePlus aria-hidden className="size-4" />
            </button>
            <button
              type="button"
              className={toolButton}
              aria-label="Prompt library"
              title="Prompt library"
              onClick={() => {
                setPromptsOpen(true)
              }}
            >
              <BookText aria-hidden className="size-4" />
            </button>
            <button
              type="button"
              className={`${toolButton} relative`}
              aria-label={settingsCustomized ? 'Chat settings (customized)' : 'Chat settings'}
              title="Chat settings"
              onClick={onOpenSettings}
            >
              <SlidersHorizontal aria-hidden className="size-4" />
              {settingsCustomized && (
                <span
                  aria-hidden
                  className="absolute top-1 right-1 size-2 rounded-full bg-primary"
                />
              )}
            </button>
            {dictation.supported && (
              <button
                type="button"
                className={`${toolButton} ${dictation.listening ? 'text-error' : ''}`}
                aria-label={dictation.listening ? 'Stop dictating' : 'Dictate'}
                aria-pressed={dictation.listening}
                disabled={isSending}
                onClick={dictation.toggle}
              >
                <Mic aria-hidden className="size-4" />
              </button>
            )}
            <span className="flex-1" />
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
        </div>
        <div className="mt-1 flex justify-between gap-2 px-2 text-xs">
          {hint ? (
            <span className="text-error">{hint}</span>
          ) : (
            <span className="hidden text-base-content/80 sm:inline">
              Enter to send · Shift+Enter for a new line
            </span>
          )}
          <span className="flex gap-3 text-base-content/80">
            {tokens !== null && content.trim() && (
              <span title="Counted by the provider, with the chat's earlier messages">
                ≈ {tokens.toLocaleString('en')} input tokens
              </span>
            )}
            {length >= SHOW_COUNTER_FROM && (
              <span className={length > MAX_MESSAGE_LENGTH ? 'text-error' : ''}>
                {length.toLocaleString('en')} / {MAX_MESSAGE_LENGTH.toLocaleString('en')}
              </span>
            )}
          </span>
        </div>
      </form>
      {/* Outside the form: the library's own form must not submit the message. */}
      {promptsOpen && (
        <PromptLibrary
          currentText={content}
          onInsert={(text) => {
            setValue('content', text)
            setFocus('content')
          }}
          onClose={() => {
            setPromptsOpen(false)
          }}
        />
      )}
    </>
  )
}
