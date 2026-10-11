import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { useT } from './i18n'
import MatchPage from './pages/MatchPage'
import NotFoundPage from './pages/NotFoundPage'
import PlayerPage from './pages/PlayerPage'
import SearchPage from './pages/SearchPage'

const queryClient = new QueryClient()

export default function App() {
  const t = useT()
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <header className="mx-auto max-w-2xl px-4 pt-4">
          <Link
            to="/"
            className="rounded-md text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {t.app.homeLink}
          </Link>
        </header>
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/players/:playerId" element={<PlayerPage />} />
          <Route path="/matches/:matchId" element={<MatchPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
