import { useCallback, useEffect, useRef, useState } from 'react'

// The Web Speech API isn't in TypeScript's DOM types yet; only what is used here.
interface RecognitionResult {
  isFinal: boolean
  0: { transcript: string }
}
interface RecognitionEvent {
  resultIndex: number
  results: ArrayLike<RecognitionResult>
}
interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: RecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}
type RecognitionConstructor = new () => Recognition

function recognitionClass(): RecognitionConstructor | null {
  const scope = window as unknown as Record<string, RecognitionConstructor | undefined>
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

/** Dictate with the browser's speech recognition (Chrome, Edge, Safari); `supported` is false
 * elsewhere. Each finished phrase is passed to `onText`. */
export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<Recognition | null>(null)
  const onTextRef = useRef(onText)
  useEffect(() => {
    onTextRef.current = onText
  }, [onText])
  useEffect(() => () => recognitionRef.current?.stop(), [])

  const toggle = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      return
    }
    const Recognition = recognitionClass()
    if (!Recognition) return
    const recognition = new Recognition()
    recognition.lang = navigator.language
    recognition.continuous = true
    recognition.interimResults = false
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result?.isFinal) onTextRef.current(result[0].transcript.trim())
      }
    }
    recognition.onend = recognition.onerror = () => {
      recognitionRef.current = null
      setListening(false)
    }
    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
  }, [])

  return { supported: recognitionClass() !== null, listening, toggle }
}
