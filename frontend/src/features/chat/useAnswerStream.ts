import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getListMessagesQueryKey } from '../../api/generated/api'
import { streamAnswer } from '../../api/stream'

interface AnswerStreamState {
  /** The message being answered, or null when idle. */
  prompt: string | null
  /** The answer received so far. */
  reply: string
  isStreaming: boolean
  error: unknown
}

const idle: AnswerStreamState = { prompt: null, reply: '', isStreaming: false, error: null }

/** Streams an answer and refreshes the history once the exchange is stored. */
export function useAnswerStream() {
  const queryClient = useQueryClient()
  const [state, setState] = useState<AnswerStreamState>(idle)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  /** Resolves when the answer is complete; rejects (and keeps the error) when it fails. */
  const send = useCallback(
    async (content: string) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setState({ prompt: content, reply: '', isStreaming: true, error: null })

      try {
        await streamAnswer(content, {
          signal: controller.signal,
          onDelta: (text) => {
            setState((current) => ({ ...current, reply: current.reply + text }))
          },
        })
        // Keep the streamed answer on screen until the history shows the stored exchange.
        await queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey() })
        setState(idle)
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
