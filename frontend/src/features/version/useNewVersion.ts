import { useEffect, useState } from 'react'

// The build writes this file (see vite.config.ts); nginx serves it uncached.
const VERSION_URL = '/version.json'
const CHECK_EVERY_MS = 5_000

const reloadPage = () => {
  window.location.reload()
}

async function fetchBuild(): Promise<string | null> {
  try {
    const response = await fetch(VERSION_URL, { cache: 'no-store' })
    if (!response.ok) return null
    const { build } = (await response.json()) as { build?: unknown }
    return typeof build === 'string' ? build : null
  } catch {
    // Not built (dev server) or the server is restarting: try again later.
    return null
  }
}

/** Reloading now would lose something: an answer being written, typed text or an open dialog. */
export function isBusy(): boolean {
  const message = document.getElementById('message') as HTMLTextAreaElement | null
  return Boolean(
    message?.disabled ||
    message?.value.trim() ||
    document.querySelector('[role="dialog"], [role="alertdialog"]'),
  )
}

/**
 * Watches for a new deployment of the app. When one appears the page reloads itself, unless the
 * user is busy; then it returns true so they can reload when ready. Off outside production
 * builds, where Vite reloads the page on its own.
 */
export function useNewVersion({
  enabled = import.meta.env.PROD,
  reload = reloadPage,
}: { enabled?: boolean; reload?: () => void } = {}): boolean {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let loaded: string | null = null
    let stopped = false
    const check = async () => {
      if (document.visibilityState === 'hidden') return
      const build = await fetchBuild()
      if (stopped || build === null) return
      loaded ??= build
      if (build === loaded) return
      if (isBusy()) setAvailable(true)
      else reload()
    }
    void check()
    const timer = setInterval(() => void check(), CHECK_EVERY_MS)
    const onVisible = () => void check()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, reload])

  return available
}
