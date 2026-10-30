import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getListConversationMessagesQueryKey,
  getListConversationsQueryKey,
} from '../../api/generated/api'
import type { ExchangeRead, MessageCreate } from '../../api/generated/model'
import { streamAnswer } from '../../api/stream'

interface AnswerStreamState {
  /** The message being answered, or null when idle. */
  prompt: string | null
  /** The conversation it was sent to; null for a new one. */
  conversationId: number | null
  /** The answer received so far. */
  reply: string
  isStreaming: boolean
  error: unknown
}

const idle: AnswerStreamState = {
  prompt: null,
  conversationId: null,
  reply: '',
  isStreaming: false,
  error: null,
}

interface SendOptions {
  /** Called once the exchange is stored, e.g. to open the conversation it started. */
  onStored?: (exchange: ExchangeRead) => void
}

/** Streams an answer and adds the stored exchange to its conversation's cached messages. */
export function useAnswerStream() {
  const queryClient = useQueryClient()
  const [state, setState] = useState<AnswerStreamState>(idle)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  /** Resolves when the answer is complete; rejects (and keeps the error) when it fails. */
  const send = useCallback(
    async (message: MessageCreate, { onStored }: SendOptions = {}) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setState({
        ...idle,
        prompt: message.content,
        conversationId: message.conversation_id ?? null,
        isStreaming: true,
      })

      try {
        await streamAnswer(message, {
          signal: controller.signal,
          onDelta: (text) => {
            setState((current) => ({ ...current, reply: current.reply + text }))
          },
          onDone: (exchange) => {
            // The stored exchange replaces the streamed one without refetching.
            queryClient.setQueryData<ExchangeRead[]>(
              getListConversationMessagesQueryKey(exchange.conversation_id),
              (messages) => [...(messages ?? []), exchange],
            )
            setState(idle)
            onStored?.(exchange)
            void queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() })
          },
          onTitle: () => {
            void queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() })
          },
        })
      } catch (error) {
        if (controller.signal.aborted) return
        setState({ ...idle, error })
        throw error
      }
    },
    [queryClient],
  )

  return { ...state, send }
}
