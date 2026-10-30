import { createContext, useContext } from 'react'
import type { MessageCreateProvider, ModelSettingsRead } from '../../api/generated/model'

export type Provider = NonNullable<MessageCreateProvider>

export interface ModelChoice {
  provider: Provider
  model: string
}

export interface ModelChoiceState {
  /** Null while the settings load, or when no provider is configured. */
  choice: ModelChoice | null
  choose: (choice: ModelChoice) => void
}

export const ModelChoiceContext = createContext<ModelChoiceState | null>(null)

/** The provider and model new messages are sent to; picked in the header. */
export function useModelChoice(): ModelChoiceState {
  const state = useContext(ModelChoiceContext)
  if (!state) throw new Error('useModelChoice must be used inside ModelChoiceProvider')
  return state
}

export const PROVIDER_LABELS: Record<string, string> = { claude: 'Claude', gemini: 'Gemini' }

function isProvider(name: string): name is Provider {
  return name === 'claude' || name === 'gemini'
}

/** The wanted choice if it can still be used, else the API's default, else any usable model. */
export function resolveChoice(
  settings: ModelSettingsRead,
  wanted: ModelChoice | null,
): ModelChoice | null {
  const usable = settings.providers.filter((item) => item.available && item.models.length > 0)
  if (
    wanted &&
    usable.some((item) => item.name === wanted.provider && item.models.includes(wanted.model))
  ) {
    return wanted
  }
  const fallback =
    usable.find((item) => item.name === settings.default_provider) ?? usable.at(0) ?? null
  if (!fallback || !isProvider(fallback.name)) return null
  return { provider: fallback.name, model: fallback.models[0] ?? '' }
}
