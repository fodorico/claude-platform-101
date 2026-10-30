import { Sparkles } from 'lucide-react'
import { Link, Outlet } from 'react-router'
import { ThemeToggle } from './ThemeToggle'

export function Layout() {
  return (
    <div className="flex h-full flex-col bg-base-200">
      <header className="navbar border-b border-base-300 bg-base-100/80 px-4 backdrop-blur">
        <div className="flex-1">
          <Link to="/" className="flex items-center gap-2 text-lg font-semibold">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-content">
              <Sparkles aria-hidden className="size-4" />
            </span>
            Claude Platform 101
          </Link>
        </div>
        <ThemeToggle />
      </header>
      <main className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  )
}
