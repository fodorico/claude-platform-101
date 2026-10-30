import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link to="/" className="btn btn-primary">
        Back to chat
      </Link>
    </div>
  )
}
