import { RefreshCw } from 'lucide-react'
import { useNewVersion } from './useNewVersion'

/** Offers a reload when a new version was deployed while the user was busy. */
export function NewVersionNotice() {
  const available = useNewVersion()
  if (!available) return null
  return (
    <div role="status" className="toast toast-center toast-top z-50">
      <div className="alert alert-info py-2 text-sm shadow-lg">
        <span>A new version of the app is available.</span>
        <button
          type="button"
          className="btn btn-sm gap-1"
          onClick={() => {
            window.location.reload()
          }}
        >
          <RefreshCw aria-hidden className="size-4" />
          Reload
        </button>
      </div>
    </div>
  )
}
