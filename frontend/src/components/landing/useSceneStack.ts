import { useEffect, useRef, useState } from 'react'
import { loadImage } from '@/lib/loadImage'
import { mapSceneryUrl } from '@/lib/mapArt'

/**
 * The pictures of the landing page's scenery as they are shown: the one that is in view (or coming in) and the one it
 * came in over. The page's backdrop and the sample's frame both draw from one stack, so that they change at the same
 * moment and fetch the same file once.
 */
export interface SceneStack {
  /** The picture that is shown, or is coming in. */
  over: string | null
  /** The picture it came in over; it stays underneath, so that the new one never fades in from nothing. */
  under: string | null
  /** The picture the page opened with. It is the only one that is waited for on the page itself (see `fade`). */
  first: string | null
  /** Whether the first picture has arrived. */
  firstArrived: boolean
  /** Called by whatever draws the first picture, once that picture has arrived. */
  onFirstArrived: () => void
}

/**
 * Keeps the stack of the active map's scenery. A picture comes in only once it has arrived and been decoded
 * (`loadImage`): until then the one before it stays. A map without a picture, or one that did not come in time, leaves
 * the stack as it is.
 */
export function useSceneStack(mapName: string): SceneStack {
  const scenery = mapSceneryUrl(mapName)
  const [pictures, setPictures] = useState<{ over: string | null; under: string | null }>({
    over: scenery,
    under: null,
  })
  // The first picture is in the page from the start and fetched by its own element; it comes in when it has arrived.
  const [first] = useState(scenery)
  const [firstArrived, setFirstArrived] = useState(false)
  const shown = useRef(scenery)

  useEffect(() => {
    if (!scenery || scenery === shown.current) {
      return
    }
    let stale = false
    void loadImage(scenery).then((loaded) => {
      if (loaded && !stale) {
        shown.current = scenery
        setPictures((now) => ({ over: scenery, under: now.over }))
      }
    })
    return () => {
      stale = true
    }
  }, [scenery])

  return { ...pictures, first, firstArrived, onFirstArrived: () => setFirstArrived(true) }
}

/**
 * The class that brings a picture of the stack in, or null for one that is not coming in: the picture on top fades in
 * over the one before it (`animate-scene-in`; nothing fades for a visitor who asked for less motion), and the first
 * one stays invisible until it has arrived, so that it does not paint line by line.
 */
export function fade(stack: SceneStack, url: string): string | null {
  if (url !== stack.over) {
    return null
  }
  return url !== stack.first || stack.firstArrived ? 'animate-scene-in' : 'opacity-0'
}
