import { Check, Copy } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'

/** A code block with a button that copies its text. */
function CodeBlock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  return (
    <div className="group relative">
      <pre ref={ref}>{children}</pre>
      <button
        type="button"
        className="btn btn-ghost btn-xs absolute top-2 right-2 gap-1 bg-base-100/80"
        aria-label={copied ? 'Copied' : 'Copy code'}
        onClick={() => {
          navigator.clipboard
            .writeText(ref.current?.innerText ?? '')
            .then(() => {
              setCopied(true)
              setTimeout(() => {
                setCopied(false)
              }, 1500)
            })
            .catch(() => undefined)
        }}
      >
        {copied ? (
          <Check aria-hidden className="size-3" />
        ) : (
          <Copy aria-hidden className="size-3" />
        )}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

/** Renders a model answer. Raw HTML in the answer is not rendered (react-markdown's default);
 * fenced code is highlighted when it names its language. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-sm max-w-none prose-pre:bg-base-300 prose-pre:text-base-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false }]]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
