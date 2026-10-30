import { ArrowDown, CircleAlert, Download, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { errorMessage } from '../api/errors'
import { useGetConversation, useListConversationMessages } from '../api/generated/api'
import { AssistantMessage, UserBubble } from '../features/chat/Bubbles'
import { DetailsPanel } from '../features/chat/DetailsPanel'
import { EmptyState } from '../features/chat/EmptyState'
import { downloadChat } from '../features/chat/exportChat'
import { HistoryPanel } from '../features/chat/HistoryPanel'
import { MessageForm } from '../features/chat/MessageForm'
import { useAnswerStream } from '../features/chat/useAnswerStream'
import { useModelChoice } from '../features/models/modelChoice'
import { usePanels } from '../features/panels/panels'

/** The open conversation lives in the URL (`/?chat=12`); no `chat` means a new one. */
const CHAT_PARAM = 'chat'

// Below Tailwind's `lg` breakpoint the panels are drawers over the chat.
const isSmallScreen = () => window.matchMedia('(max-width: 1023px)').matches

// How close to the end (px) still counts as "at the bottom" for following new text.
const BOTTOM_SLACK = 80

function useConversationId(): number | null {
  const [params] = useSearchParams()
  const id = Number(params.get(CHAT_PARAM))
  return Number.isInteger(id) && id > 0 ? id : null
}

export function ChatPage() {
  const conversationId = useConversationId()
  const [, setParams] = useSearchParams()
  const conversation = useGetConversation(conversationId ?? 0, {
    query: { enabled: conversationId !== null },
  })
  const messages = useListConversationMessages(conversationId ?? 0, {
    query: { enabled: conversationId !== null },
  })
  const answer = useAnswerStream()
  const { choice } = useModelChoice()
  const panels = usePanels()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // The last exchange while its question is being edited in the message box.
  const [editingId, setEditingId] = useState<number | null>(null)
  // Remounting the form clears it, e.g. after a successful retry from the error message.
  const [formKey, setFormKey] = useState(0)
  const endRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  // Read when a new chat's first answer is stored, which may be after the user moved on.
  const conversationIdRef = useRef(conversationId)
  useEffect(() => {
    conversationIdRef.current = conversationId
  }, [conversationId])

  const stored = conversationId === null ? [] : (messages.data ?? [])
  // The streamed (or stopped) answer belongs to the conversation it was sent to.
  const pending = answer.prompt !== null && answer.conversationId === conversationId ? answer : null
  // An exchange being regenerated or edited is hidden until its replacement is stored.
  const exchanges = pending?.isStreaming
    ? stored.filter((exchange) => exchange.id !== pending.replacesId)
    : stored
  const last = exchanges.at(-1)
  const canChangeLast = !answer.isStreaming && pending === null
  const isEmpty = conversationId === null && pending === null
  // With nothing picked, the details panel describes the latest answer.
  const selected =
    exchanges.find((exchange) => exchange.id === selectedId) ?? exchanges.at(-1) ?? null
  const title = conversation.data?.title ?? ''

  // Follow new text only while the reader is at the bottom; scrolling up stops following.
  useEffect(() => {
    if (atBottom) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [conversationId, messages.data, pending?.prompt, pending?.reply, atBottom])

  const openConversation = (id: number | null) => {
    setSelectedId(null)
    setEditingId(null)
    answer.clear()
    setAtBottom(true)
    setParams(id === null ? {} : { [CHAT_PARAM]: String(id) })
  }

  const send = (content: string, replacesId: number | null = editingId) => {
    setSelectedId(null)
    setAtBottom(true)
    const startedIn = conversationId
    return answer.send(
      {
        content,
        conversation_id: conversationId,
        provider: choice?.provider,
        model: choice?.model,
        replaces_id: replacesId,
      },
      {
        onStored: (exchange) => {
          setEditingId(null)
          // A new chat gets its URL once stored, unless the user already opened another one.
          if (startedIn === null && conversationIdRef.current === null) {
            setParams({ [CHAT_PARAM]: String(exchange.conversation_id) })
          }
        },
      },
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {panels.open.history && (
        <HistoryPanel
          currentId={conversationId}
          onOpen={(id) => {
            openConversation(id)
            if (isSmallScreen()) panels.close('history')
          }}
          onDeleted={(ids) => {
            if (conversationId !== null && ids.includes(conversationId)) openConversation(null)
          }}
          onClose={() => {
            panels.close('history')
          }}
        />
      )}

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {conversationId !== null && (
          <div className="flex items-center gap-2 border-b border-base-300 px-4 py-1.5">
            <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h1>
            <button
              type="button"
              className="btn btn-ghost btn-sm gap-2"
              aria-label="Export chat as Markdown"
              title="Export chat as Markdown"
              disabled={stored.length === 0}
              onClick={() => {
                downloadChat(title || 'Chat', stored)
              }}
            >
              <Download aria-hidden className="size-4" />
              <span aria-hidden className="hidden sm:inline">
                Export
              </span>
            </button>
          </div>
        )}

        <section
          aria-label="Conversation"
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(event) => {
            const box = event.currentTarget
            setAtBottom(box.scrollHeight - box.scrollTop - box.clientHeight < BOTTOM_SLACK)
          }}
        >
          <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 px-4 py-6">
            {conversationId !== null && messages.isPending && (
              <span className="loading loading-dots mx-auto my-auto" aria-label="Loading" />
            )}
            {conversationId !== null && messages.isError && (
              <div role="alert" className="alert alert-warning alert-soft text-base-content">
                <span>{errorMessage(messages.error)}</span>
              </div>
            )}
            {isEmpty && (
              <EmptyState
                disabled={answer.isStreaming || !choice}
                onPick={(suggestion) => {
                  send(suggestion, null).catch(() => undefined)
                }}
              />
            )}
            {exchanges.map((exchange) => {
              const isLast = canChangeLast && exchange === last
              return (
                <div key={exchange.id} className="flex flex-col gap-4">
                  <UserBubble
                    text={exchange.prompt}
                    onEdit={
                      isLast
                        ? () => {
                            setEditingId(exchange.id)
                          }
                        : undefined
                    }
                  />
                  <AssistantMessage
                    text={exchange.reply}
                    exchange={exchange}
                    isSelected={panels.open.details && exchange.id === selected?.id}
                    onShowDetails={() => {
                      setSelectedId(exchange.id)
                      panels.show('details')
                    }}
                    onRegenerate={
                      isLast
                        ? () => {
                            send(exchange.prompt, exchange.id).catch(() => undefined)
                          }
                        : undefined
                    }
                  />
                </div>
              )
            })}
            {pending && (
              <div className="flex flex-col gap-4">
                <UserBubble text={pending.prompt ?? ''} />
                <AssistantMessage
                  text={pending.reply}
                  isStreaming={pending.isStreaming}
                  stopped={pending.stopped}
                />
              </div>
            )}
            <div ref={endRef} />
          </div>
        </section>

        <section aria-label="Compose" className="relative px-4 pt-2 pb-4">
          {!atBottom && (
            <button
              type="button"
              className="btn btn-circle btn-sm absolute -top-10 left-1/2 -translate-x-1/2 shadow-md"
              aria-label="Scroll to the latest answer"
              onClick={() => {
                setAtBottom(true)
              }}
            >
              <ArrowDown aria-hidden className="size-4" />
            </button>
          )}
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            {answer.error !== null && (
              <div role="alert" className="alert alert-error alert-soft py-2 text-base-content">
                <CircleAlert aria-hidden className="size-5" />
                <span className="flex-1">{errorMessage(answer.error)}</span>
                <button
                  type="button"
                  className="btn btn-sm gap-1"
                  onClick={() => {
                    answer
                      .retry()
                      .then(() => {
                        setFormKey((key) => key + 1)
                      })
                      .catch(() => undefined)
                  }}
                >
                  <RotateCcw aria-hidden className="size-4" />
                  Retry
                </button>
              </div>
            )}
            <MessageForm
              key={formKey}
              onSend={send}
              isSending={answer.isStreaming}
              onStop={answer.stop}
              editing={stored.find((exchange) => exchange.id === editingId)?.prompt ?? null}
              onCancelEdit={() => {
                setEditingId(null)
              }}
            />
          </div>
        </section>
      </div>

      {panels.open.details && (
        <DetailsPanel
          exchange={pending?.isStreaming ? null : selected}
          exchanges={stored}
          isStreaming={pending?.isStreaming ?? false}
          onClose={() => {
            panels.close('details')
          }}
        />
      )}
    </div>
  )
}
