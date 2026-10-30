import { Bot } from 'lucide-react'
import { Link, Outlet } from 'react-router'

export function Layout() {
  return (
    <div className="min-h-screen bg-base-200">
      <header className="navbar bg-base-100 shadow-sm">
        <Link to="/" className="btn btn-ghost text-lg">
          <Bot aria-hidden className="size-5" />
          Claude Platform 101
        </Link>
      </header>
      <main className="mx-auto max-w-3xl p-4">
        <Outlet />
      </main>
    </div>
  )
}
