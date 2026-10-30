import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { errorMessage } from '../../api/errors'
import { useGetApiCall } from '../../api/generated/api'
import { Dialog } from '../../components/Dialog'
import { PROVIDER_LABELS } from '../models/modelChoice'

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const [copied, setCopied] = useState(false)
  const json = JSON.stringify(value, null, 2)
  return (
    <section aria-label={label} className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{label}</h3>
        <button
          type="button"
          className="btn btn-ghost btn-xs gap-1"
          onClick={() => {
            navigator.clipboard
              .writeText(json)
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
          {copied ? 'Copied' : `Copy ${label.toLowerCase()}`}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-box bg-neutral p-3 text-xs leading-relaxed text-neutral-content">
        {json}
      </pre>
    </section>
  )
}

/** The request the API sent to the provider for one answer, and the usage it returned. */
export function ApiCallDialog({
  exchangeId,
  onClose,
}: {
  exchangeId: number
  onClose: () => void
}) {
  const call = useGetApiCall(exchangeId)
  return (
    <Dialog title="API call" onClose={onClose} size="max-w-3xl">
      {call.isPending && <span className="loading loading-dots" aria-label="Loading" />}
      {call.isError && (
        <p role="alert" className="text-sm">
          {errorMessage(call.error)}
        </p>
      )}
      {call.data && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-base-content/80">
            Sent to the {PROVIDER_LABELS[call.data.provider] ?? call.data.provider} API. Images are
            shown by size; earlier messages are rebuilt from the chat.
          </p>
          <JsonBlock label="Request" value={call.data.request} />
          <JsonBlock label="Usage" value={call.data.usage} />
        </div>
      )}
    </Dialog>
  )
}
