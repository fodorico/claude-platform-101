export const timeFormat = new Intl.DateTimeFormat('en', { timeStyle: 'short' })

const dayFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })

/** "850 ms", "1.2 s", or an em dash when the time was not measured. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  return ms < 1000 ? `${String(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** "Today", "Yesterday" or the date, for grouping messages by day. */
export function dayLabel(date: Date, now = new Date()): string {
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return dayFormat.format(date)
}
