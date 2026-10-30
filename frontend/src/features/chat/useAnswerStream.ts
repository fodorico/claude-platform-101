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
  /** The exchange this answer will replace (regenerate or edit), hidden meanwhile. */
  replacesId: number | null
  /** The answer received so far. */
  reply: string
  /** The model's reasoning received so far, when the chat shows it. */
  thinking: string
  /** Data URLs of the images sent with the message, to show them meanwhile. */
  images: string[]
  isStreaming: boolean
  /** The user stopped the answer: what arrived stays on screen but was not saved. */
  stopped: boolean
  error: unknown
}

const idle: AnswerStreamState = {
  prompt: null,
  conversationId: null,
  replacesId: null,
  reply: '',
  thinking: '',
  images: [],
  isStreaming: false,
  stopped: false,
  error: null,
}

interface SendOptions {
  /** Called once the exchange is stored, e.g. to open the conversation it started. */
  onStored?: (exchange: ExchangeRead) => void
}

/** Streams an answer and puts the stored exchange in its conversation's cached messages. */
export function useAnswerStream() {
  const queryClient = useQueryClient()
  const [state, setState] = useState<AnswerStreamState>(idle)
  const abortRef = useRef<AbortController | null>(null)
  const lastRef = useRef<{ message: MessageCreate; options: SendOptions } | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  /** Resolves when the answer is complete or stopped; rejects (and keeps the error) when it
   * fails. */
  const send = useCallback(
    async (message: MessageCreate, options: SendOptions = {}) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      lastRef.current = { message, options }
      setState({
        ...idle,
        prompt: message.content,
        conversationId: message.conversation_id ?? null,
        replacesId: message.replaces_id ?? null,
        images: (message.images ?? []).map(
          (image) => `data:${image.media_type};base64,${image.data}`,
        ),
        isStreaming: true,
      })

      try {
        await streamAnswer(message, {
          signal: controller.signal,
          onDelta: (text) => {
            setState((current) => ({ ...current, reply: current.reply + text }))
          },
          onThinking: (text) => {
            setState((current) => ({ ...current, thinking: current.thinking + text }))
          },
          onDone: (exchange) => {
            // The stored exchange takes the place of the streamed one without refetching; a new
            // version of a message makes the earlier versions inactive.
            queryClient.setQueryData<ExchangeRead[]>(
              getListConversationMessagesQueryKey(exchange.conversation_id),
              (messages) => [
                ...(messages ?? []).map((item) =>
                  item.version_group === exchange.version_group
                    ? { ...item, is_active: false }
                    : item,
                ),
                exchange,
              ],
            )
            setState(idle)
            options.onStored?.(exchange)
            void queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() })
          },
          onTitle: () => {
            void queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() })
          },
        })
      } catch (error) {
        if (controller.signal.aborted) return
        // The text stays in the message box for a retry, so nothing is shown here.
        setState({ ...idle, error })
        throw error
      }
    },
    [queryClient],
  )

  /** Stop the answer being written; the server stores nothing for it. */
  const stop = useCallback(() => {
    abortRef.current?.abort()
    setState((current) =>
      current.isStreaming ? { ...current, isStreaming: false, stopped: true } : current,
    )
  }, [])

  /** Send the last message again, e.g. after an error. */
  const retry = useCallback(() => {
    const last = lastRef.current
    return last ? send(last.message, last.options) : Promise.resolve()
  }, [send])

  /** Forget a stopped or failed answer. */
  const clear = useCallback(() => {
    setState(idle)
  }, [])

  return { ...state, send, stop, retry, clear }
}
