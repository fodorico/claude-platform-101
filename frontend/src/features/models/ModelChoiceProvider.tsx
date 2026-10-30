import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useGetModelSettings } from '../../api/generated/api'
import { ModelChoiceContext, resolveChoice, type ModelChoice } from './modelChoice'

const STORAGE_KEY = 'model'

function storedChoice(): ModelChoice | null {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown
    if (stored && typeof stored === 'object') {
      const { provider, model } = stored as Record<string, unknown>
      if ((provider === 'claude' || provider === 'gemini') && typeof model === 'string') {
        return { provider, model }
      }
    }
  } catch {
    // Storage blocked or invalid: use the API's default.
  }
  return null
}

export function ModelChoiceProvider({ children }: { children: ReactNode }) {
  const settings = useGetModelSettings()
  const [wanted, setWanted] = useState(storedChoice)

  const choose = useCallback((choice: ModelChoice) => {
    setWanted(choice)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(choice))
    } catch {
      // Not persisted; the choice still applies to this visit.
    }
  }, [])

  // A saved choice that is no longer offered (e.g. its API key was removed) falls back.
  const choice = settings.data ? resolveChoice(settings.data, wanted) : null
  const value = useMemo(() => ({ choice, choose }), [choice, choose])
  return <ModelChoiceContext value={value}>{children}</ModelChoiceContext>
}
