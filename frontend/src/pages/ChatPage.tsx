import { CircleAlert } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { errorMessage } from '../api/errors'
import { useListMessages } from '../api/generated/api'
import { AssistantBubble, UserBubble } from '../features/chat/Bubbles'
import { EmptyState } from '../features/chat/EmptyState'
import { MessageForm } from '../features/chat/MessageForm'
import { useAnswerStream } from '../features/chat/useAnswerStream'

const HISTORY_LIMIT = 20

export function ChatPage() {
  const history = useListMessages({ limit: HISTORY_LIMIT })
  const answer = useAnswerStream()
  const endRef = useRef<HTMLDivElement>(null)

  // The API returns newest first; a conversation reads oldest first.
  const exchanges = history.data ? [...history.data].reverse() : []
  const isEmpty = history.isSuccess && exchanges.length === 0 && answer.prompt === null

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [history.data, answer.prompt, answer.reply])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section aria-label="Conversation" className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-2 px-4 py-6">
          {history.isPending && (
            <span className="loading loading-dots mx-auto my-auto" aria-label="Loading" />
          )}
          {history.isError && (
            <div role="alert" className="alert alert-warning alert-soft">
              <span>{errorMessage(history.error)}</span>
            </div>
          )}
          {isEmpty && (
            <EmptyState
              disabled={answer.isStreaming}
              onPick={(suggestion) => {
                answer.send(suggestion).catch(() => undefined)
              }}
            />
          )}
          {exchanges.map((exchange) => (
            <div key={exchange.id}>
              <UserBubble text={exchange.prompt} />
              <AssistantBubble
                text={exchange.reply}
                model={exchange.model}
                createdAt={exchange.created_at}
              />
            </div>
          ))}
          {answer.prompt !== null && (
            <div>
              <UserBubble text={answer.prompt} />
              <AssistantBubble text={answer.reply} isStreaming={answer.isStreaming} />
            </div>
          )}
          <div ref={endRef} />
        </div>
      </section>

      <section aria-label="Compose" className="border-t border-base-300 bg-base-200/90">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 pt-3 pb-2">
          {answer.error !== null && (
            <div role="alert" className="alert alert-error alert-soft py-2">
              <CircleAlert aria-hidden className="size-5" />
              <span>{errorMessage(answer.error)}</span>
            </div>
          )}
          <MessageForm onSend={answer.send} isSending={answer.isStreaming} />
        </div>
      </section>
    </div>
  )
}
