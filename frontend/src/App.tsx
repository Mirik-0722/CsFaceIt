import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import MatchPage from './pages/MatchPage'
import NotFoundPage from './pages/NotFoundPage'
import PlayerHighlightsPage from './pages/PlayerHighlightsPage'
import PlayerPage from './pages/PlayerPage'
import SearchPage from './pages/SearchPage'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Every page, the 404 included, sits inside the same frame: top bar, page, footer. */}
          <Route element={<AppLayout />}>
            <Route path="/" element={<SearchPage />} />
            <Route path="/players/:playerId" element={<PlayerPage />} />
            <Route path="/players/:playerId/highlights" element={<PlayerHighlightsPage />} />
            <Route path="/matches/:matchId" element={<MatchPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
