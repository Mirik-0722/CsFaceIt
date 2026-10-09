import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import MatchPage from './pages/MatchPage'
import PlayerPage from './pages/PlayerPage'
import SearchPage from './pages/SearchPage'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/players/:playerId" element={<PlayerPage />} />
          <Route path="/matches/:matchId" element={<MatchPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
