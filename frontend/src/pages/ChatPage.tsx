import { CircleAlert } from 'lucide-react'
import { errorMessage } from '../api/errors'
import { useListMessages } from '../api/generated/api'
import { ExchangeCard } from '../features/chat/ExchangeCard'
import { MessageForm } from '../features/chat/MessageForm'
import { useAnswerStream } from '../features/chat/useAnswerStream'

const HISTORY_LIMIT = 20

export function ChatPage() {
  const history = useListMessages({ limit: HISTORY_LIMIT })
  const answer = useAnswerStream()

  return (
    <div className="flex flex-col gap-6">
      <section className="card bg-base-100 shadow-sm">
        <div className="card-body">
          <MessageForm onSend={answer.send} isSending={answer.isStreaming} />
          {answer.error !== null && (
            <div role="alert" className="alert alert-error alert-soft">
              <CircleAlert aria-hidden className="size-5" />
              <span>{errorMessage(answer.error)}</span>
            </div>
          )}
        </div>
      </section>

      <section aria-label="History" className="flex flex-col gap-3">
        {answer.prompt !== null && (
          <article aria-busy={answer.isStreaming} className="card bg-base-100 shadow-sm">
            <div className="card-body gap-3">
              <p className="font-medium whitespace-pre-wrap">{answer.prompt}</p>
              <p className="whitespace-pre-wrap text-base-content/80" aria-live="polite">
                {answer.reply}
                {answer.isStreaming && (
                  <span className="loading loading-dots loading-xs ml-1" aria-label="Writing" />
                )}
              </p>
            </div>
          </article>
        )}
        {history.isPending && (
          <span className="loading loading-dots mx-auto" aria-label="Loading" />
        )}
        {history.isError && (
          <div role="alert" className="alert alert-warning alert-soft">
            <span>{errorMessage(history.error)}</span>
          </div>
        )}
        {history.data?.length === 0 && answer.prompt === null && (
          <p className="text-center text-base-content/60">
            No messages yet. Ask your first question.
          </p>
        )}
        {history.data?.map((exchange) => (
          <ExchangeCard key={exchange.id} exchange={exchange} />
        ))}
      </section>
    </div>
  )
}
