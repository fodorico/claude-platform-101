import { Sparkles, User } from 'lucide-react'
import { motion } from 'motion/react'
import { Markdown } from './Markdown'

const timeFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })

const appear = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 } }

export function UserBubble({ text }: { text: string }) {
  return (
    <motion.div {...appear} className="chat chat-end">
      <div className="chat-image avatar avatar-placeholder">
        <div className="w-8 rounded-full bg-neutral text-neutral-content">
          <User aria-hidden className="size-4" />
        </div>
      </div>
      <div className="chat-bubble chat-bubble-primary whitespace-pre-wrap">{text}</div>
    </motion.div>
  )
}

interface AssistantBubbleProps {
  text: string
  model?: string
  createdAt?: string
  /** True while the answer is still arriving. */
  isStreaming?: boolean
}

export function AssistantBubble({ text, model, createdAt, isStreaming }: AssistantBubbleProps) {
  return (
    <motion.div {...appear} className="chat chat-start">
      <div className="chat-image avatar avatar-placeholder">
        <div className="w-8 rounded-full bg-primary text-primary-content">
          <Sparkles aria-hidden className="size-4" />
        </div>
      </div>
      <div
        className="chat-bubble bg-base-100 text-base-content shadow-sm"
        aria-live={isStreaming ? 'polite' : undefined}
        aria-busy={isStreaming}
      >
        {text ? <Markdown>{text}</Markdown> : null}
        {isStreaming && (
          <span className="loading loading-dots loading-sm text-primary" aria-label="Writing" />
        )}
      </div>
      {model && createdAt && (
        <div className="chat-footer mt-1 text-xs text-base-content/80">
          {model} · {timeFormat.format(new Date(createdAt))}
        </div>
      )}
    </motion.div>
  )
}
