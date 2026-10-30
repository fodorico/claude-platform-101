import { CircleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '../api/errors'
import { useListMessages } from '../api/generated/api'
import { AssistantMessage, UserBubble } from '../features/chat/Bubbles'
import { DetailsPanel } from '../features/chat/DetailsPanel'
import { EmptyState } from '../features/chat/EmptyState'
import { HistoryPanel } from '../features/chat/HistoryPanel'
import { MessageForm } from '../features/chat/MessageForm'
import { useAnswerStream } from '../features/chat/useAnswerStream'
import { usePanels } from '../features/panels/panels'

const HISTORY_LIMIT = 20

// Below Tailwind's `lg` breakpoint the panels are drawers over the chat.
const isSmallScreen = () => window.matchMedia('(max-width: 1023px)').matches

export function ChatPage() {
  const history = useListMessages({ limit: HISTORY_LIMIT })
  const answer = useAnswerStream()
  const panels = usePanels()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const newestFirst = history.data ?? []
  // The API returns newest first; a conversation reads oldest first.
  const exchanges = [...newestFirst].reverse()
  const isEmpty = history.isSuccess && exchanges.length === 0 && answer.prompt === null
  // With nothing picked, the details panel describes the latest answer.
  const selected =
    newestFirst.find((exchange) => exchange.id === selectedId) ?? newestFirst[0] ?? null

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [history.data, answer.prompt, answer.reply])

  const send = (content: string) => {
    setSelectedId(null)
    return answer.send(content)
  }

  const pickFromHistory = (id: number) => {
    setSelectedId(id)
    document
      .getElementById(`exchange-${String(id)}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (isSmallScreen()) panels.close('history')
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {panels.open.history && (
        <HistoryPanel
          exchanges={newestFirst}
          selectedId={selected?.id ?? null}
          onSelect={pickFromHistory}
          onClose={() => {
            panels.close('history')
          }}
        />
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <section aria-label="Conversation" className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 px-4 py-6">
            {history.isPending && (
              <span className="loading loading-dots mx-auto my-auto" aria-label="Loading" />
            )}
            {history.isError && (
              <div role="alert" className="alert alert-warning alert-soft text-base-content">
                <span>{errorMessage(history.error)}</span>
              </div>
            )}
            {isEmpty && (
              <EmptyState
                disabled={answer.isStreaming}
                onPick={(suggestion) => {
                  send(suggestion).catch(() => undefined)
                }}
              />
            )}
            {exchanges.map((exchange) => (
              <div
                key={exchange.id}
                id={`exchange-${String(exchange.id)}`}
                className="flex scroll-mt-4 flex-col gap-4"
              >
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
            {answer.prompt !== null && (
              <div className="flex flex-col gap-4">
                <UserBubble text={answer.prompt} />
                <AssistantMessage text={answer.reply} isStreaming={answer.isStreaming} />
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
          exchange={answer.isStreaming ? null : selected}
          isStreaming={answer.isStreaming}
          onClose={() => {
            panels.close('details')
          }}
        />
      )}
    </div>
  )
}
