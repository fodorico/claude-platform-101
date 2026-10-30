import { createContext, useContext } from 'react'

export type PanelName = 'history' | 'details'

export interface PanelsState {
  open: Record<PanelName, boolean>
  toggle: (panel: PanelName) => void
  show: (panel: PanelName) => void
  close: (panel: PanelName) => void
}

export const PanelsContext = createContext<PanelsState | null>(null)

/** Which side panels are open; provided by the layout so the header can toggle them. */
export function usePanels(): PanelsState {
  const panels = useContext(PanelsContext)
  if (!panels) throw new Error('usePanels must be used inside PanelsProvider')
  return panels
}
