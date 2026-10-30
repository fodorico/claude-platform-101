import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { PanelsContext, type PanelName, type PanelsState } from './panels'

const STORAGE_KEY = 'panels'

// Both closed by default: the chat alone, like before the panels existed.
const closed: Record<PanelName, boolean> = { history: false, details: false }

function initialOpen(): Record<PanelName, boolean> {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown
    if (stored && typeof stored === 'object') {
      const { history, details } = stored as Partial<Record<PanelName, unknown>>
      return { history: history === true, details: details === true }
    }
  } catch {
    // Storage blocked or invalid: start with the panels closed.
  }
  return closed
}

export function PanelsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(initialOpen)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(open))
    } catch {
      // Not persisted; the choice still applies to this visit.
    }
  }, [open])

  const toggle = useCallback((panel: PanelName) => {
    setOpen((current) => ({ ...current, [panel]: !current[panel] }))
  }, [])
  const show = useCallback((panel: PanelName) => {
    setOpen((current) => ({ ...current, [panel]: true }))
  }, [])
  const close = useCallback((panel: PanelName) => {
    setOpen((current) => ({ ...current, [panel]: false }))
  }, [])

  const value = useMemo<PanelsState>(
    () => ({ open, toggle, show, close }),
    [open, toggle, show, close],
  )
  return <PanelsContext value={value}>{children}</PanelsContext>
}
