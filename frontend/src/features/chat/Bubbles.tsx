import { Check, Copy, Info, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import type { ExchangeRead } from '../../api/generated/model'
import { formatDuration, timeFormat } from './format'
import { Markdown } from './Markdown'

const appear = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 } }

export function UserBubble({ text }: { text: string }) {
  return (
    <motion.div {...appear} className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-base-300 px-4 py-2.5 whitespace-pre-wrap">
        {text}
      </div>
    </motion.div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="btn btn-ghost btn-square btn-sm"
      aria-label={copied ? 'Copied' : 'Copy answer'}
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true)
            setTimeout(() => {
              setCopied(false)
            }, 1500)
          })
          .catch(() => undefined)
      }}
    >
      {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
    </button>
  )
}

interface AssistantMessageProps {
  text: string
  /** The stored exchange; absent while the answer is still arriving. */
  exchange?: ExchangeRead
  isSelected?: boolean
  onShowDetails?: () => void
  /** True while the answer is still arriving. */
  isStreaming?: boolean
}

export function AssistantMessage({
  text,
  exchange,
  isSelected,
  onShowDetails,
  isStreaming,
}: AssistantMessageProps) {
  return (
    <motion.div {...appear} className="flex gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-content">
        <Sparkles aria-hidden className="size-4" />
      </span>
      <div
        className={`min-w-0 flex-1 rounded-box px-3 py-1 ${isSelected ? 'bg-base-100 ring-2 ring-primary' : ''}`}
        aria-live={isStreaming ? 'polite' : undefined}
        aria-busy={isStreaming}
      >
        {text ? <Markdown>{text}</Markdown> : null}
        {isStreaming && (
          <span className="loading loading-dots loading-sm text-primary" aria-label="Writing" />
        )}
        {exchange && (
          <div className="-ml-2 flex flex-wrap items-center gap-1 pb-1">
            <CopyButton text={text} />
            {onShowDetails && (
              <button
                type="button"
                className="btn btn-ghost btn-square btn-sm"
                aria-label="Show request details"
                onClick={onShowDetails}
              >
                <Info aria-hidden className="size-4" />
              </button>
            )}
            <span className="ml-1 text-xs text-base-content/80">
              {[
                exchange.model,
                // Answers stored before timings were measured have none.
                exchange.duration_ms === null ? null : formatDuration(exchange.duration_ms),
                timeFormat.format(new Date(exchange.created_at)),
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  )
}
