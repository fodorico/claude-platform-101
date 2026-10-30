import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** Renders a model answer. Raw HTML in the answer is not rendered (react-markdown's default). */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-sm max-w-none prose-pre:bg-base-300 prose-pre:text-base-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
