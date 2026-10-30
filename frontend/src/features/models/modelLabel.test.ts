import { describe, expect, it } from 'vitest'
import { modelLabel } from './modelLabel'

describe('modelLabel', () => {
  it.each([
    ['claude-opus-5-5', 'Opus 5.5'],
    ['claude-haiku-5-5', 'Haiku 5.5'],
    ['gemini-flash-lite-latest', 'Flash Lite'],
    ['gemini-2.5-pro', '2.5 Pro'],
  ])('shortens %s to %s', (id, label) => {
    expect(modelLabel(id)).toBe(label)
  })
})
