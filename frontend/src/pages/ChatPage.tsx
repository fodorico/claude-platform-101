import { useQueryClient } from '@tanstack/react-query'
import { CircleAlert } from 'lucide-react'
import { errorMessage } from '../api/errors'
import { getListMessagesQueryKey, useListMessages, useSendMessage } from '../api/generated/api'
import { ExchangeCard } from '../features/chat/ExchangeCard'
import { MessageForm } from '../features/chat/MessageForm'

const HISTORY_LIMIT = 20

export function ChatPage() {
  const queryClient = useQueryClient()
  const history = useListMessages({ limit: HISTORY_LIMIT })
  const sendMessage = useSendMessage({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey() }),
    },
  })

  return (
    <div className="flex flex-col gap-6">
      <section className="card bg-base-100 shadow-sm">
        <div className="card-body">
          <MessageForm
            onSend={(content) => sendMessage.mutateAsync({ data: { content } })}
            isSending={sendMessage.isPending}
          />
          {sendMessage.isError && (
            <div role="alert" className="alert alert-error alert-soft">
              <CircleAlert aria-hidden className="size-5" />
              <span>{errorMessage(sendMessage.error)}</span>
            </div>
          )}
        </div>
      </section>

      <section aria-label="History" className="flex flex-col gap-3">
        {history.isPending && (
          <span className="loading loading-dots mx-auto" aria-label="Loading" />
        )}
        {history.isError && (
          <div role="alert" className="alert alert-warning alert-soft">
            <span>{errorMessage(history.error)}</span>
          </div>
        )}
        {history.data?.length === 0 && (
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
