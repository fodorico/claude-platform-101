import { PanelLeft, PanelRight, Sparkles, SquarePen, type LucideIcon } from 'lucide-react'
import { Link, Outlet } from 'react-router'
import { ModelChoiceProvider } from '../features/models/ModelChoiceProvider'
import { ModelPicker } from '../features/models/ModelPicker'
import { PanelsProvider } from '../features/panels/PanelsProvider'
import { usePanels, type PanelName } from '../features/panels/panels'
import { NewVersionNotice } from '../features/version/NewVersionNotice'
import { Shortcuts } from './Shortcuts'
import { ThemeToggle } from './ThemeToggle'

function PanelToggle({
  panel,
  label,
  icon: Icon,
}: {
  panel: PanelName
  label: string
  icon: LucideIcon
}) {
  const panels = usePanels()
  return (
    <button
      type="button"
      className="btn btn-ghost btn-square"
      aria-label={label}
      aria-pressed={panels.open[panel]}
      onClick={() => {
        panels.toggle(panel)
      }}
    >
      <Icon aria-hidden className="size-5" />
    </button>
  )
}

export function Layout() {
  return (
    <PanelsProvider>
      <ModelChoiceProvider>
        <div className="flex h-full flex-col bg-base-200">
          <header className="navbar min-h-14 gap-1 border-b border-base-300 bg-base-100 px-2 sm:px-4">
            <PanelToggle panel="history" label="History" icon={PanelLeft} />
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <Link to="/" className="flex min-w-0 items-center gap-2 px-1 text-lg font-semibold">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-content">
                  <Sparkles aria-hidden className="size-4" />
                </span>
                <span className="sr-only truncate sm:not-sr-only">Claude Platform 101</span>
              </Link>
              <ThemeToggle />
            </div>
            <ModelPicker />
            <Link
              to="/"
              className="btn btn-ghost btn-square hidden sm:inline-flex"
              aria-label="New chat"
            >
              <SquarePen aria-hidden className="size-5" />
            </Link>
            <Shortcuts />
            <PanelToggle panel="details" label="Request details" icon={PanelRight} />
          </header>
          <main className="flex min-h-0 flex-1">
            <Outlet />
          </main>
          <NewVersionNotice />
        </div>
      </ModelChoiceProvider>
    </PanelsProvider>
  )
}
