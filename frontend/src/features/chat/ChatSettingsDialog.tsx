import { useState } from 'react'
import { useGetModelSettings } from '../../api/generated/api'
import type { ChatSettings } from '../../api/generated/model'
import { Dialog } from '../../components/Dialog'

interface ChatSettingsDialogProps {
  settings: ChatSettings
  /** A new chat keeps them until its first message; an existing one saves them now. */
  isNewChat: boolean
  onSave: (settings: ChatSettings) => void
  onClose: () => void
}

/** How the model answers in this chat: system prompt, temperature, answer length, reasoning. */
export function ChatSettingsDialog({
  settings,
  isNewChat,
  onSave,
  onClose,
}: ChatSettingsDialogProps) {
  const defaults = useGetModelSettings().data
  const [systemPrompt, setSystemPrompt] = useState(settings.system_prompt ?? '')
  const [temperature, setTemperature] = useState(settings.temperature ?? null)
  const [maxTokens, setMaxTokens] = useState(settings.max_tokens?.toString() ?? '')
  const [showThinking, setShowThinking] = useState(settings.show_thinking ?? false)

  return (
    <Dialog title="Chat settings" onClose={onClose}>
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          onSave({
            system_prompt: systemPrompt.trim() || null,
            temperature,
            max_tokens: maxTokens ? Number(maxTokens) : null,
            show_thinking: showThinking,
          })
          onClose()
        }}
      >
        <p className="text-sm text-base-content/80">
          {isNewChat
            ? 'These settings apply to the chat you start with your next message.'
            : 'These settings apply to the next messages in this chat.'}
        </p>

        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="system-prompt" className="font-medium">
            System prompt
          </label>
          <textarea
            id="system-prompt"
            aria-describedby="system-prompt-hint"
            className="textarea w-full font-mono text-xs"
            rows={5}
            maxLength={10_000}
            placeholder={defaults?.system_prompt}
            value={systemPrompt}
            onChange={(event) => {
              setSystemPrompt(event.target.value)
            }}
          />
          <span id="system-prompt-hint" className="text-xs text-base-content/80">
            Instructions the model follows for the whole chat. Empty uses the default shown.
          </span>
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="temperature" className="font-medium">
              Temperature
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="checkbox checkbox-primary checkbox-xs"
                checked={temperature === null}
                onChange={(event) => {
                  setTemperature(event.target.checked ? null : 1)
                }}
              />
              Model default
            </label>
          </div>
          <div className="flex items-center gap-3">
            <input
              id="temperature"
              aria-describedby="temperature-hint"
              type="range"
              className="range range-primary range-sm flex-1"
              min={0}
              max={2}
              step={0.1}
              disabled={temperature === null}
              value={temperature ?? 1}
              onChange={(event) => {
                setTemperature(Number(event.target.value))
              }}
            />
            <span className="w-8 text-right tabular-nums">
              {temperature === null ? '—' : temperature.toFixed(1)}
            </span>
          </div>
          <span id="temperature-hint" className="text-xs text-base-content/80">
            Lower is more focused, higher more varied. Gemini only: current Claude models choose it
            themselves.
          </span>
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="max-tokens" className="font-medium">
            Max tokens
          </label>
          <input
            id="max-tokens"
            aria-describedby="max-tokens-hint"
            type="number"
            className="input input-sm w-40"
            min={1}
            max={128_000}
            placeholder={defaults ? String(defaults.max_tokens) : undefined}
            value={maxTokens}
            onChange={(event) => {
              setMaxTokens(event.target.value)
            }}
          />
          <span id="max-tokens-hint" className="text-xs text-base-content/80">
            The longest answer allowed, reasoning included. Empty uses the default.
          </span>
        </div>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="toggle toggle-primary toggle-sm mt-0.5"
            checked={showThinking}
            onChange={(event) => {
              setShowThinking(event.target.checked)
            }}
          />
          <span className="flex flex-col gap-1">
            <span className="font-medium">Show reasoning</span>
            <span className="text-xs text-base-content/80">
              See a summary of how the model thought before answering.
            </span>
          </span>
        </label>

        <div className="flex justify-between gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setSystemPrompt('')
              setTemperature(null)
              setMaxTokens('')
              setShowThinking(false)
            }}
          >
            Reset to defaults
          </button>
          <button type="submit" className="btn btn-primary btn-sm">
            Save
          </button>
        </div>
      </form>
    </Dialog>
  )
}
