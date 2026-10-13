import { useLayoutEffect } from 'react'
import { Outlet, useLocation, useNavigationType } from 'react-router-dom'
import Footer from '@/components/Footer'
import TopBar from '@/components/TopBar'
import UnlinkedNotice from '@/components/UnlinkedNotice'
import { useHasUnlinkedNotice } from '@/lib/viewer'

/**
 * Under the bar of a signed-in visitor whose Steam account has no FACEIT player: the notice that says so, on every page
 * (spec 6). The home page says it in its hero, in place of the sign-in buttons, so it is not said twice there.
 */
function UnlinkedStrip() {
  const unlinked = useHasUnlinkedNotice()
  const { pathname } = useLocation()
  if (!unlinked || pathname === '/') {
    return null
  }
  return (
    <div className="container-page pt-7">
      <UnlinkedNotice />
    </div>
  )
}

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
    // `isolate`: what a page lays behind itself and the top bar (the landing page's backdrop) stays over the ground of
    // the page and under everything else.
    <div className="isolate flex min-h-dvh flex-col">
      <TopBar />
      <UnlinkedStrip />
      {/* A plain block, not a flex container, so a page's own `<main>` keeps its block layout (auto margins centre it). */}
      <div className="flex-1">
        <Outlet />
      </div>
      <Footer />
    </div>
  )
}
