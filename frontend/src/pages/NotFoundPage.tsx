import { Link } from 'react-router-dom'

/** The catch-all route: a mistyped URL gets a message and a way back instead of a blank page. */
export default function NotFoundPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link
        to="/"
        className="w-fit rounded-md text-sm underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Back to search
      </Link>
    </main>
  )
}
