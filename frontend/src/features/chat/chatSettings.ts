import type { ChatSettings } from '../../api/generated/model'

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  system_prompt: null,
  temperature: null,
  max_tokens: null,
  show_thinking: false,
}

/** True when the settings differ from the API's defaults. */
export function isCustomized(settings: ChatSettings): boolean {
  return (
    !!settings.system_prompt ||
    settings.temperature != null ||
    settings.max_tokens != null ||
    !!settings.show_thinking
  )
}
