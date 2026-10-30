const ACRONYMS: Record<string, string> = { gpt: 'GPT' }

/** A readable name for a model id: "claude-opus-5-5" → "Opus 5.5",
 * "gemini-flash-lite-latest" → "Flash Lite". The id stays available as a tooltip. */
export function modelLabel(id: string): string {
  const words: string[] = []
  const numbers: string[] = []
  for (const part of id.split('-').slice(1)) {
    if (part === 'latest') continue
    if (/^\d+$/.test(part)) numbers.push(part)
    else words.push(ACRONYMS[part] ?? part.charAt(0).toUpperCase() + part.slice(1))
  }
  const label = [...words, numbers.join('.')].filter(Boolean).join(' ')
  return label || id
}
