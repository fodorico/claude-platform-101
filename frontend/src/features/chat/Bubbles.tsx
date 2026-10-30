import {
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Copy,
  GitBranch,
  Info,
  Pencil,
  RotateCcw,
  Shuffle,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  Volume2,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import type { ExchangeRead } from '../../api/generated/model'
import { modelLabel } from '../models/modelLabel'
import type { ModelChoice } from '../models/modelChoice'
import { formatDuration, timeFormat } from './format'
import { Markdown } from './Markdown'

const appear = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 } }
const iconButton = 'btn btn-ghost btn-square btn-sm'

interface UserBubbleProps {
  text: string
  /** Image URLs sent with the message. */
  images?: string[]
  onEdit?: () => void
}

export function UserBubble({ text, images = [], onEdit }: UserBubbleProps) {
  return (
    <motion.div {...appear} className="flex items-end justify-end gap-1">
      {onEdit && (
        <button
          type="button"
          className={`${iconButton} mt-1`}
          aria-label="Edit question"
          onClick={onEdit}
        >
          <Pencil aria-hidden className="size-4" />
        </button>
      )}
      <div className="flex max-w-[85%] flex-col items-end gap-2">
        {images.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            {images.map((url, index) => (
              <a key={url} href={url} target="_blank" rel="noreferrer">
                <img
                  src={url}
                  alt={`Attached image ${String(index + 1)}`}
                  className="size-24 rounded-box object-cover"
                />
              </a>
            ))}
          </div>
        )}
        <div className="rounded-2xl rounded-br-sm bg-base-300 px-4 py-2.5 whitespace-pre-wrap">
          {text}
        </div>
      </div>
    </motion.div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={iconButton}
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

const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window

/** Read the answer aloud with the browser's speech synthesis; hidden where there is none. */
function ReadAloudButton({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false)
  useEffect(
    () => () => {
      if (speaking) window.speechSynthesis.cancel()
    },
    [speaking],
  )
  if (!canSpeak()) return null
  return (
    <button
      type="button"
      className={iconButton}
      aria-label={speaking ? 'Stop reading' : 'Read aloud'}
      aria-pressed={speaking}
      onClick={() => {
        window.speechSynthesis.cancel()
        if (speaking) {
          setSpeaking(false)
          return
        }
        // Markdown symbols would be read out loud.
        const utterance = new SpeechSynthesisUtterance(text.replace(/[#*_`>|-]/g, ' '))
        utterance.onend = () => {
          setSpeaking(false)
        }
        setSpeaking(true)
        window.speechSynthesis.speak(utterance)
      }}
    >
      {speaking ? (
        <Square aria-hidden className="size-4 fill-current" />
      ) : (
        <Volume2 aria-hidden className="size-4" />
      )}
    </button>
  )
}

/** The model's reasoning, folded by default once the answer is complete. */
function Reasoning({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  const [open, setOpen] = useState(false)
  const shown = open || isStreaming
  return (
    <div className="mb-2 rounded-box border border-base-300">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-base-content/80"
        aria-expanded={shown}
        onClick={() => {
          setOpen(!open)
        }}
      >
        <Brain aria-hidden className="size-4" />
        <span className="flex-1">{isStreaming ? 'Thinking…' : 'Reasoning'}</span>
        <ChevronDown aria-hidden className={`size-4 transition ${shown ? 'rotate-180' : ''}`} />
      </button>
      {shown && (
        <div className="border-t border-base-300 px-3 py-2 text-sm text-base-content/80">
          <Markdown>{text}</Markdown>
        </div>
      )}
    </div>
  )
}

export interface Versions {
  /** Zero-based position of the shown version. */
  index: number
  count: number
  /** Show another version; absent when the versions can't be switched (not the last message). */
  onSelect?: (index: number) => void
  onCompare: () => void
}

interface AssistantMessageProps {
  text: string
  thinking?: string | null
  /** The stored exchange; absent while the answer is still arriving. */
  exchange?: ExchangeRead
  isSelected?: boolean
  onShowDetails?: () => void
  /** Offered on the last answer: ask the same question again. */
  onRegenerate?: () => void
  /** Offered with onRegenerate: ask again with another model. */
  regenerateWith?: { models: ModelChoice[]; onPick: (choice: ModelChoice) => void }
  onRate?: (rating: -1 | 0 | 1) => void
  onFork?: () => void
  versions?: Versions
  /** True while the answer is still arriving. */
  isStreaming?: boolean
  /** The user stopped this answer; it was not saved. */
  stopped?: boolean
}

export function AssistantMessage({
  text,
  thinking,
  exchange,
  isSelected,
  onShowDetails,
  onRegenerate,
  regenerateWith,
  onRate,
  onFork,
  versions,
  isStreaming,
  stopped,
}: AssistantMessageProps) {
  const [modelsOpen, setModelsOpen] = useState(false)
  const rating = exchange?.rating ?? 0
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
        {thinking ? <Reasoning text={thinking} isStreaming={isStreaming && !text} /> : null}
        {text ? <Markdown>{text}</Markdown> : null}
        {isStreaming && (
          <span className="loading loading-dots loading-sm text-primary" aria-label="Writing" />
        )}
        {stopped && (
          <p className="pb-1 text-xs text-base-content/80">Stopped. This answer wasn't saved.</p>
        )}
        {exchange && (
          <div className="-ml-2 flex flex-wrap items-center gap-0.5 pb-1">
            {versions && versions.count > 1 && (
              <div className="mr-1 flex items-center" role="group" aria-label="Versions">
                <button
                  type="button"
                  className={iconButton}
                  aria-label="Previous version"
                  disabled={!versions.onSelect || versions.index === 0}
                  onClick={() => versions.onSelect?.(versions.index - 1)}
                >
                  <ChevronLeft aria-hidden className="size-4" />
                </button>
                <span className="text-xs tabular-nums">
                  {versions.index + 1} / {versions.count}
                </span>
                <button
                  type="button"
                  className={iconButton}
                  aria-label="Next version"
                  disabled={!versions.onSelect || versions.index === versions.count - 1}
                  onClick={() => versions.onSelect?.(versions.index + 1)}
                >
                  <ChevronRight aria-hidden className="size-4" />
                </button>
                <button
                  type="button"
                  className={iconButton}
                  aria-label="Compare versions"
                  onClick={versions.onCompare}
                >
                  <Columns2 aria-hidden className="size-4" />
                </button>
              </div>
            )}
            <CopyButton text={text} />
            {onRate && (
              <>
                <button
                  type="button"
                  className={iconButton}
                  aria-label="Good answer"
                  aria-pressed={rating === 1}
                  onClick={() => {
                    onRate(rating === 1 ? 0 : 1)
                  }}
                >
                  <ThumbsUp
                    aria-hidden
                    className={`size-4 ${rating === 1 ? 'fill-current' : ''}`}
                  />
                </button>
                <button
                  type="button"
                  className={iconButton}
                  aria-label="Bad answer"
                  aria-pressed={rating === -1}
                  onClick={() => {
                    onRate(rating === -1 ? 0 : -1)
                  }}
                >
                  <ThumbsDown
                    aria-hidden
                    className={`size-4 ${rating === -1 ? 'fill-current' : ''}`}
                  />
                </button>
              </>
            )}
            {onRegenerate && (
              <button
                type="button"
                className={iconButton}
                aria-label="Regenerate answer"
                onClick={onRegenerate}
              >
                <RotateCcw aria-hidden className="size-4" />
              </button>
            )}
            {onRegenerate && regenerateWith && regenerateWith.models.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm gap-1 px-2 text-xs font-normal"
                  aria-expanded={modelsOpen}
                  onClick={() => {
                    setModelsOpen(!modelsOpen)
                  }}
                >
                  <Shuffle aria-hidden className="size-4 sm:hidden" />
                  <span className="sr-only sm:not-sr-only">Try another model</span>
                  <ChevronDown aria-hidden className="size-3" />
                </button>
                {modelsOpen && (
                  <ul
                    aria-label="Models"
                    className="absolute bottom-full left-0 z-10 mb-1 flex w-48 flex-col rounded-box border border-base-300 bg-base-100 p-1 shadow"
                  >
                    {regenerateWith.models.map((choice) => (
                      <li key={`${choice.provider}:${choice.model}`}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm w-full justify-start font-normal"
                          title={choice.model}
                          onClick={() => {
                            setModelsOpen(false)
                            regenerateWith.onPick(choice)
                          }}
                        >
                          {modelLabel(choice.model)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <ReadAloudButton text={text} />
            {onFork && (
              <button
                type="button"
                className={iconButton}
                aria-label="Fork chat from here"
                title="Start a new chat from this answer"
                onClick={onFork}
              >
                <GitBranch aria-hidden className="size-4" />
              </button>
            )}
            {onShowDetails && (
              <button
                type="button"
                className={iconButton}
                aria-label="Show request details"
                onClick={onShowDetails}
              >
                <Info aria-hidden className="size-4" />
              </button>
            )}
            <span className="ml-1 text-xs text-base-content/80">
              {[
                modelLabel(exchange.model),
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
