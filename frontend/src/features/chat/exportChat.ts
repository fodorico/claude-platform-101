import type { ExchangeRead } from '../../api/generated/model'

/** The chat as a Markdown document: the title, then each question and answer. */
export function chatToMarkdown(title: string, exchanges: ExchangeRead[]): string {
  const parts = [`# ${title}`]
  for (const exchange of exchanges) {
    parts.push(
      `## You\n\n${exchange.prompt}`,
      `## Assistant (${exchange.model})\n\n${exchange.reply}`,
    )
  }
  return parts.join('\n\n') + '\n'
}

/** A file name from the title: "Tech lead vs team lead" → "tech-lead-vs-team-lead.md". */
export function exportFileName(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${slug || 'chat'}.md`
}

/** Download the chat as a Markdown file. */
export function downloadChat(title: string, exchanges: ExchangeRead[]): void {
  const blob = new Blob([chatToMarkdown(title, exchanges)], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = exportFileName(title)
  link.click()
  URL.revokeObjectURL(url)
}
