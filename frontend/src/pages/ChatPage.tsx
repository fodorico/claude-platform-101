import { CircleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { errorMessage } from '../api/errors'
import { useListConversationMessages, useListConversations } from '../api/generated/api'
import { AssistantMessage, UserBubble } from '../features/chat/Bubbles'
import { DetailsPanel } from '../features/chat/DetailsPanel'
import { EmptyState } from '../features/chat/EmptyState'
import { HistoryPanel } from '../features/chat/HistoryPanel'
import { MessageForm } from '../features/chat/MessageForm'
import { useAnswerStream } from '../features/chat/useAnswerStream'
import { useModelChoice } from '../features/models/modelChoice'
import { usePanels } from '../features/panels/panels'

/** The open conversation lives in the URL (`/?chat=12`); no `chat` means a new one. */
const CHAT_PARAM = 'chat'

// Below Tailwind's `lg` breakpoint the panels are drawers over the chat.
const isSmallScreen = () => window.matchMedia('(max-width: 1023px)').matches

function useConversationId(): number | null {
  const [params] = useSearchParams()
  const id = Number(params.get(CHAT_PARAM))
  return Number.isInteger(id) && id > 0 ? id : null
}

export function ChatPage() {
  const conversationId = useConversationId()
  const [, setParams] = useSearchParams()
  const conversations = useListConversations()
  const messages = useListConversationMessages(conversationId ?? 0, {
    query: { enabled: conversationId !== null },
  })
  const answer = useAnswerStream()
  const { choice } = useModelChoice()
  const panels = usePanels()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  // Read when a new chat's first answer is stored, which may be after the user moved on.
  const conversationIdRef = useRef(conversationId)
  useEffect(() => {
    conversationIdRef.current = conversationId
  }, [conversationId])

  const exchanges = conversationId === null ? [] : (messages.data ?? [])
  // The streamed answer belongs to the conversation it was sent to.
  const pending = answer.prompt !== null && answer.conversationId === conversationId ? answer : null
  const isEmpty = conversationId === null && pending === null
  // With nothing picked, the details panel describes the latest answer.
  const selected =
    exchanges.find((exchange) => exchange.id === selectedId) ?? exchanges.at(-1) ?? null

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [conversationId, messages.data, pending?.prompt, pending?.reply])

  const openConversation = (id: number | null) => {
    setSelectedId(null)
    setParams(id === null ? {} : { [CHAT_PARAM]: String(id) })
  }

  const send = (content: string) => {
    setSelectedId(null)
    const startedIn = conversationId
    return answer.send(
      {
        content,
        conversation_id: conversationId,
        provider: choice?.provider,
        model: choice?.model,
      },
      {
        onStored: (exchange) => {
          // A new chat gets its URL once stored, unless the user already opened another one.
          if (startedIn === null && conversationIdRef.current === null) {
            openConversation(exchange.conversation_id)
          }
        },
      },
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {panels.open.history && (
        <HistoryPanel
          conversations={conversations.data ?? []}
          currentId={conversationId}
          onOpen={(id) => {
            openConversation(id)
            if (isSmallScreen()) panels.close('history')
          }}
          onClose={() => {
            panels.close('history')
          }}
        />
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <section aria-label="Conversation" className="min-h-0 flex-1 overflow-y-auto">
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
            {exchanges.map((exchange) => (
              <div key={exchange.id} className="flex flex-col gap-4">
                <UserBubble text={exchange.prompt} />
                <AssistantMessage
                  text={exchange.reply}
                  exchange={exchange}
                  isSelected={panels.open.details && exchange.id === selected?.id}
                  onShowDetails={() => {
                    setSelectedId(exchange.id)
                    panels.show('details')
                  }}
                />
              </div>
            ))}
            {pending && (
              <div className="flex flex-col gap-4">
                <UserBubble text={pending.prompt ?? ''} />
                <AssistantMessage text={pending.reply} isStreaming={pending.isStreaming} />
              </div>
            )}
            <div ref={endRef} />
          </div>
        </section>

        <section aria-label="Compose" className="px-4 pt-2 pb-4">
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            {answer.error !== null && (
              <div role="alert" className="alert alert-error alert-soft py-2 text-base-content">
                <CircleAlert aria-hidden className="size-5" />
                <span>{errorMessage(answer.error)}</span>
              </div>
            )}
            <MessageForm onSend={send} isSending={answer.isStreaming} />
          </div>
        </section>
      </div>

      {panels.open.details && (
        <DetailsPanel
          exchange={pending?.isStreaming ? null : selected}
          isStreaming={pending?.isStreaming ?? false}
          onClose={() => {
            panels.close('details')
          }}
        />
      )}
    </div>
  )
}
