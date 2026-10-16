import { useLayoutEffect, useState } from 'react'
import { Outlet, useLocation, useNavigationType } from 'react-router-dom'
import { useMe } from '@/api/auth'
import BottomNav from '@/components/BottomNav'
import Footer from '@/components/Footer'
import SignInDialog from '@/components/SignInDialog'
import TopBar from '@/components/TopBar'
import UnlinkedNotice from '@/components/UnlinkedNotice'
import { hasBottomNav } from '@/lib/bottomNav'
import { cn } from '@/lib/utils'
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
 * The frame around every page: the top bar, the page, which takes the free height, the footer at the bottom, and on a
 * phone the bottom navigation. A page reached by a link starts at the top of the window; back and forward (POP) are
 * left to the browser, which puts the page where it was. The sign-in dialog is the frame's: both bars open it.
 */
export default function AppLayout() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const me = useMe()
  const [signInOpen, setSignInOpen] = useState(false)
  // Before the browser paints, so that the new page is never seen at the old page's scroll position.
  useLayoutEffect(() => {
    if (navigationType !== 'POP') {
      window.scrollTo(0, 0)
    }
  }, [location, navigationType])
  // Where the bottom navigation is, the page and the footer end above it (the bar is fixed over the window's bottom
  // edge), so that the last row and the footer's notice can be scrolled clear of it.
  const bottomNav = hasBottomNav(me.data != null, location.pathname)
  return (
    // `isolate`: what a page lays behind itself and the top bar (the landing page's backdrop) stays over the ground of
    // the page and under everything else.
    <div className={cn('isolate flex min-h-dvh flex-col', bottomNav && 'max-md:pb-[var(--bottom-nav-h)]')}>
      <TopBar onSignIn={() => setSignInOpen(true)} />
      <UnlinkedStrip />
      {/* A plain block, not a flex container, so a page's own `<main>` keeps its block layout (auto margins centre it). */}
      <div className="flex-1">
        <Outlet />
      </div>
      <Footer />
      <BottomNav onSignIn={() => setSignInOpen(true)} />
      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
    </div>
  )
}
