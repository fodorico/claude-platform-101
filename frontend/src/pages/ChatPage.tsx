import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, CircleAlert, Download, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { errorMessage } from '../api/errors'
import {
  countMessageTokens,
  getGetConversationQueryKey,
  getListConversationMessagesQueryKey,
  getListConversationsQueryKey,
  useForkConversation,
  useGetConversation,
  useGetModelSettings,
  useListConversationMessages,
  useUpdateConversation,
  useUpdateExchange,
} from '../api/generated/api'
import type { ChatSettings, ExchangeRead, ImageCreate } from '../api/generated/model'
import { AssistantMessage, UserBubble } from '../features/chat/Bubbles'
import { DEFAULT_CHAT_SETTINGS, isCustomized } from '../features/chat/chatSettings'
import { ChatSettingsDialog } from '../features/chat/ChatSettingsDialog'
import { CompareDialog } from '../features/chat/CompareDialog'
import { DetailsPanel } from '../features/chat/DetailsPanel'
import { EmptyState } from '../features/chat/EmptyState'
import { downloadChat } from '../features/chat/exportChat'
import { HistoryPanel } from '../features/chat/HistoryPanel'
import { attachmentUrl } from '../features/chat/images'
import { MessageForm } from '../features/chat/MessageForm'
import { useAnswerStream } from '../features/chat/useAnswerStream'
import { activeExchanges, toTurns } from '../features/chat/versions'
import { useModelChoice, usableModels, type ModelChoice } from '../features/models/modelChoice'
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

interface SendOptions {
  /** The last exchange, when regenerating or editing it. */
  replacesId?: number | null
  /** Another model than the one picked in the header. */
  model?: ModelChoice
  images?: ImageCreate[]
}

export function ChatPage() {
  const conversationId = useConversationId()
  const [, setParams] = useSearchParams()
  const queryClient = useQueryClient()
  const conversation = useGetConversation(conversationId ?? 0, {
    query: { enabled: conversationId !== null },
  })
  const messages = useListConversationMessages(conversationId ?? 0, {
    query: { enabled: conversationId !== null },
  })
  const modelSettings = useGetModelSettings()
  const answer = useAnswerStream()
  const { choice } = useModelChoice()
  const panels = usePanels()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // The last exchange while its question is being edited in the message box.
  const [editingId, setEditingId] = useState<number | null>(null)
  // Remounting the form clears it, e.g. after a successful retry from the error message.
  const [formKey, setFormKey] = useState(0)
  // Settings for a new chat, sent with its first message.
  const [draftSettings, setDraftSettings] = useState<ChatSettings>(DEFAULT_CHAT_SETTINGS)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // The message whose versions are compared side by side.
  const [comparing, setComparing] = useState<number | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  // Read when a new chat's first answer is stored, which may be after the user moved on.
  const conversationIdRef = useRef(conversationId)
  useEffect(() => {
    conversationIdRef.current = conversationId
  }, [conversationId])

  const messagesKey = getListConversationMessagesQueryKey(conversationId ?? 0)
  const replaceInCache = (updated: ExchangeRead) => {
    queryClient.setQueryData<ExchangeRead[]>(messagesKey, (current) =>
      current?.map((item) => {
        if (item.id === updated.id) return updated
        // Switching versions: the others of the same message become inactive.
        if (updated.is_active && item.version_group === updated.version_group) {
          return { ...item, is_active: false }
        }
        return item
      }),
    )
  }
  const updateExchange = useUpdateExchange({ mutation: { onSuccess: replaceInCache } })
  const updateConversation = useUpdateConversation({
    mutation: {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetConversationQueryKey(updated.id), updated)
      },
    },
  })
  const fork = useForkConversation({
    mutation: {
      onSuccess: (created) => {
        void queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() })
        openConversation(created.id)
      },
    },
  })

  const stored = conversationId === null ? [] : (messages.data ?? [])
  // The streamed (or stopped) answer belongs to the conversation it was sent to.
  const pending = answer.prompt !== null && answer.conversationId === conversationId ? answer : null
  // A message being regenerated or edited is hidden until its new version is stored.
  const hiddenGroup = pending?.isStreaming
    ? stored.find((exchange) => exchange.id === pending.replacesId)?.version_group
    : undefined
  const turns = toTurns(stored).filter((turn) => turn.group !== hiddenGroup)
  const lastTurn = turns.at(-1)
  const canChangeLast = !answer.isStreaming && pending === null
  const isEmpty = conversationId === null && pending === null
  // With nothing picked, the details panel describes the latest answer.
  const selected = stored.find((exchange) => exchange.id === selectedId) ?? lastTurn?.active ?? null
  const title = conversation.data?.title ?? ''
  const chatSettings: ChatSettings =
    conversationId === null ? draftSettings : (conversation.data ?? DEFAULT_CHAT_SETTINGS)
  const comparedTurn = turns.find((turn) => turn.group === comparing)

  // Follow new text only while the reader is at the bottom; scrolling up stops following.
  useEffect(() => {
    if (atBottom) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [conversationId, messages.data, pending?.prompt, pending?.reply, pending?.thinking, atBottom])

  const openConversation = (id: number | null) => {
    setSelectedId(null)
    setEditingId(null)
    answer.clear()
    setAtBottom(true)
    if (id === null) setDraftSettings(DEFAULT_CHAT_SETTINGS)
    setParams(id === null ? {} : { [CHAT_PARAM]: String(id) })
  }

  const send = (content: string, options: SendOptions = {}) => {
    setSelectedId(null)
    setAtBottom(true)
    const startedIn = conversationId
    const model = options.model ?? choice
    return answer.send(
      {
        content,
        conversation_id: conversationId,
        provider: model?.provider,
        model: model?.model,
        replaces_id: options.replacesId ?? null,
        images: options.images ?? [],
        settings: conversationId === null ? draftSettings : null,
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

  const countTokens = useCallback(
    (content: string, images: ImageCreate[]) =>
      countMessageTokens({
        content,
        conversation_id: conversationId,
        provider: choice?.provider,
        model: choice?.model,
        replaces_id: editingId,
        images,
        settings: conversationId === null ? draftSettings : null,
      }).then((result) => result.input_tokens),
    [conversationId, choice, editingId, draftSettings],
  )

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
                downloadChat(title || 'Chat', activeExchanges(stored))
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
                  send(suggestion).catch(() => undefined)
                }}
              />
            )}
            {turns.map((turn) => {
              const exchange = turn.active
              const isLast = canChangeLast && turn === lastTurn
              const index = turn.versions.indexOf(exchange)
              return (
                <div key={turn.group} className="flex flex-col gap-4">
                  <UserBubble
                    text={exchange.prompt}
                    images={exchange.attachments.map((item) => attachmentUrl(item.id))}
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
                    thinking={exchange.thinking}
                    exchange={exchange}
                    isSelected={panels.open.details && exchange.id === selected?.id}
                    onShowDetails={() => {
                      setSelectedId(exchange.id)
                      panels.show('details')
                    }}
                    onRate={(rating) => {
                      updateExchange.mutate({ exchangeId: exchange.id, data: { rating } })
                    }}
                    onFork={() => {
                      if (conversationId === null) return
                      fork.mutate({ conversationId, data: { exchange_id: exchange.id } })
                    }}
                    versions={{
                      index,
                      count: turn.versions.length,
                      onSelect: isLast
                        ? (next) => {
                            const version = turn.versions[next]
                            if (!version) return
                            updateExchange.mutate({
                              exchangeId: version.id,
                              data: { active: true },
                            })
                          }
                        : undefined,
                      onCompare: () => {
                        setComparing(turn.group)
                      },
                    }}
                    onRegenerate={
                      isLast
                        ? () => {
                            send(exchange.prompt, { replacesId: exchange.id }).catch(
                              () => undefined,
                            )
                          }
                        : undefined
                    }
                    regenerateWith={{
                      models: usableModels(modelSettings.data),
                      onPick: (model) => {
                        send(exchange.prompt, { replacesId: exchange.id, model }).catch(
                          () => undefined,
                        )
                      },
                    }}
                  />
                </div>
              )
            })}
            {pending && (
              <div className="flex flex-col gap-4">
                <UserBubble text={pending.prompt ?? ''} images={pending.images} />
                <AssistantMessage
                  text={pending.reply}
                  thinking={pending.thinking}
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
            {(answer.error !== null || fork.error || updateExchange.error) && (
              <div role="alert" className="alert alert-error alert-soft py-2 text-base-content">
                <CircleAlert aria-hidden className="size-5" />
                <span className="flex-1">
                  {errorMessage(answer.error ?? fork.error ?? updateExchange.error)}
                </span>
                {answer.error !== null && (
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
                )}
              </div>
            )}
            <MessageForm
              key={formKey}
              onSend={(content, images) => send(content, { replacesId: editingId, images })}
              isSending={answer.isStreaming}
              onStop={answer.stop}
              editing={stored.find((exchange) => exchange.id === editingId)?.prompt ?? null}
              onCancelEdit={() => {
                setEditingId(null)
              }}
              onOpenSettings={() => {
                setSettingsOpen(true)
              }}
              settingsCustomized={isCustomized(chatSettings)}
              countTokens={choice ? countTokens : undefined}
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

      {settingsOpen && (
        <ChatSettingsDialog
          settings={chatSettings}
          isNewChat={conversationId === null}
          onSave={(settings) => {
            if (conversationId === null) setDraftSettings(settings)
            else updateConversation.mutate({ conversationId, data: { settings } })
          }}
          onClose={() => {
            setSettingsOpen(false)
          }}
        />
      )}
      {comparedTurn && (
        <CompareDialog
          versions={comparedTurn.versions}
          onClose={() => {
            setComparing(null)
          }}
        />
      )}
    </div>
  )
}
