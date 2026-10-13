import { type FocusEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { loadImage } from '@/lib/loadImage'
import { mapSceneryUrl } from '@/lib/mapArt'

/** The maps the landing page turns through, in the order of its strip. Each has an emblem and scenery. */
export const HERO_MAPS = [
  'de_mirage',
  'de_inferno',
  'de_nuke',
  'de_ancient',
  'de_anubis',
  'de_dust2',
  'de_overpass',
  'de_train',
] as const

/** How long a map stays before the next one takes its turn. */
export const TURN_MS = 5000
// The next map's scenery is asked for this long before its turn: late, so that a visitor who leaves early has fetched
// one picture only, and early enough for the picture to be there on an ordinary connection.
const PRELOAD_LEAD_MS = 600

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

// `matchMedia` is asked for with `?.`: the test environment (jsdom) has none, and there nothing is reduced.
function subscribeToReducedMotion(onChange: () => void) {
  const query = window.matchMedia?.(REDUCED_MOTION)
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.(REDUCED_MOTION).matches ?? false
}

function subscribeToVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

function isTabHidden(): boolean {
  return document.visibilityState === 'hidden'
}

export interface MapTurn {
  /** Which of `HERO_MAPS` has its turn. */
  active: number
  /** Whether the maps turn by themselves: not once the visitor has stopped them or asked the system for less motion. */
  turning: boolean
  /** Whether the turn is running right now: turning, and not held by the pointer, the keyboard or a hidden tab. */
  running: boolean
  /** Makes a map the active one at once, and stops the turning: the visitor has chosen what to look at. */
  select: (index: number) => void
  /** Stops the turning, or lets it go on. */
  toggle: () => void
  /** For the element that holds the strip: the turning waits while the pointer is over it or the keyboard is in it. */
  hold: {
    onPointerEnter: () => void
    onPointerLeave: () => void
    onFocus: (event: FocusEvent<HTMLElement>) => void
    onBlur: (event: FocusEvent<HTMLElement>) => void
  }
}

/**
 * The turning of the landing page's maps: every `TURN_MS` the next map of the strip becomes the active one. The turn
 * waits while the pointer is over the strip, while the keyboard's focus is inside it and while the tab is hidden, and
 * goes on from where it was. A map's turn comes only when its scenery has arrived (it is asked for shortly before), so
 * the backdrop never changes to a picture that is not there. A visitor who asked the system for less motion gets no
 * turning unless they press the button that starts it.
 */
export function useMapTurn(): MapTurn {
  const reducedMotion = useSyncExternalStore(subscribeToReducedMotion, prefersReducedMotion)
  const hidden = useSyncExternalStore(subscribeToVisibility, isTabHidden)
  const [active, setActive] = useState(0)
  // What the visitor chose with the button or by pressing a map; until then the system's setting decides.
  const [stopped, setStopped] = useState<boolean | null>(null)
  const [held, setHeld] = useState({ pointer: false, focus: false })
  const turning = !(stopped ?? reducedMotion)
  const running = turning && !held.pointer && !held.focus && !hidden

  // How much of the active map's turn has passed while it was running, and which map that count is of.
  const elapsed = useRef(0)
  const counted = useRef(active)

  useEffect(() => {
    if (!running) {
      return
    }
    if (counted.current !== active) {
      counted.current = active
      elapsed.current = 0
    }
    const next = (active + 1) % HERO_MAPS.length
    const scenery = mapSceneryUrl(HERO_MAPS[next])
    const startedAt = performance.now()
    const left = Math.max(0, TURN_MS - elapsed.current)
    let stale = false
    const preloadTimer = setTimeout(
      () => {
        if (scenery) {
          void loadImage(scenery)
        }
      },
      Math.max(0, left - PRELOAD_LEAD_MS),
    )
    const turnTimer = setTimeout(() => {
      // A picture that has not arrived is waited for. One that cannot be had does not stop the strip: the backdrop
      // keeps the last picture it has.
      void (scenery ? loadImage(scenery) : Promise.resolve(false)).then(() => {
        if (!stale) {
          setActive(next)
        }
      })
    }, left)
    return () => {
      stale = true
      clearTimeout(preloadTimer)
      clearTimeout(turnTimer)
      elapsed.current += performance.now() - startedAt
    }
  }, [running, active])

  return {
    active,
    turning,
    running,
    select: (index) => {
      setActive(index)
      setStopped(true)
    },
    toggle: () => {
      if (!turning) {
        // The visitor asked for it: the turn starts from its beginning, and at once, although the pointer or the focus
        // is still on the button that was pressed. They hold it again the next time they come in.
        elapsed.current = 0
        setHeld({ pointer: false, focus: false })
      }
      setStopped(turning)
    },
    hold: {
      onPointerEnter: () => setHeld((now) => ({ ...now, pointer: true })),
      onPointerLeave: () => setHeld((now) => ({ ...now, pointer: false })),
      // Only the keyboard's focus: a button pressed with the mouse keeps the focus after the pointer has left.
      onFocus: (event) => {
        if (event.target.matches(':focus-visible')) {
          setHeld((now) => ({ ...now, focus: true }))
        }
      },
      onBlur: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setHeld((now) => ({ ...now, focus: false }))
        }
      },
    },
  }
}
