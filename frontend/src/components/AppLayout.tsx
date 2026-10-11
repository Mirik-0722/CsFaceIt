import { Outlet } from 'react-router-dom'
import Footer from '@/components/Footer'
import TopBar from '@/components/TopBar'

/** The frame around every page: the top bar, the page, which takes the free height, and the footer at the bottom. */
export default function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar />
      {/* A plain block, not a flex container, so a page's own `<main>` keeps its block layout (auto margins centre it). */}
      <div className="flex-1">
        <Outlet />
      </div>
      <Footer />
    </div>
  )
}
