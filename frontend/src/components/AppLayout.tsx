import { useLayoutEffect } from 'react'
import { Outlet, useLocation, useNavigationType } from 'react-router-dom'
import Footer from '@/components/Footer'
import TopBar from '@/components/TopBar'

/**
 * The frame around every page: the top bar, the page, which takes the free height, and the footer at the bottom. A
 * page reached by a link starts at the top of the window; back and forward (POP) are left to the browser, which puts
 * the page where it was.
 */
export default function AppLayout() {
  const location = useLocation()
  const navigationType = useNavigationType()
  // Before the browser paints, so that the new page is never seen at the old page's scroll position.
  useLayoutEffect(() => {
    if (navigationType !== 'POP') {
      window.scrollTo(0, 0)
    }
  }, [location, navigationType])
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
