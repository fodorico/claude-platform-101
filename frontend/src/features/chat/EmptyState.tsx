import { MessageCircleQuestion, Sparkles } from 'lucide-react'

const SUGGESTIONS = [
  'Explain what an API is in two sentences',
  'Give me three tips to write better prompts',
  'What is the difference between a tech lead and a team lead?',
]

interface EmptyStateProps {
  onPick: (suggestion: string) => void
  disabled: boolean
}

export function EmptyState({ onPick, disabled }: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-12 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-content shadow-lg">
        <Sparkles aria-hidden className="size-7" />
      </span>
      <div>
        <h1 className="text-2xl font-semibold">What would you like to know?</h1>
        <p className="mt-1 text-base-content/80">No messages yet. Ask your first question.</p>
      </div>
      <div className="flex max-w-xl flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="btn btn-sm btn-outline font-normal"
            disabled={disabled}
            onClick={() => {
              onPick(suggestion)
            }}
          >
            <MessageCircleQuestion aria-hidden className="size-4" />
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  )
}
