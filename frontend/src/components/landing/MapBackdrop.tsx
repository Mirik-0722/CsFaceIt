import { useEffect, useRef, useState } from 'react'
import { loadImage } from '@/lib/loadImage'
import { mapSceneryUrl } from '@/lib/mapArt'
import { cn } from '@/lib/utils'

// A little above the centre: the skyline of a map is in the upper half of its picture.
const SCENE = 'absolute inset-0 size-full object-cover object-[50%_40%]'

interface Scenes {
  /** The picture that is shown, or is coming in. */
  over: string | null
  /** The picture it came in over; it stays underneath, so that the new one never fades in from nothing. */
  under: string | null
}

/**
 * The scenery of the active map behind the top bar and the hero of the landing page (spec 4, screen 1), from the top of
 * the page to the hero's bottom line, under a veil that keeps the copy readable. The hero's section is its frame: it
 * has to be `relative`.
 *
 * When the map changes, its picture comes in over the one before it (`animate-scene-in`; nothing fades for a visitor
 * who asked for less motion). A picture is shown only once it has arrived: until then the one before it stays. Only the
 * first map's picture is fetched with the page. All of it is decoration: empty `alt`, never announced.
 */
export default function MapBackdrop({ mapName }: { mapName: string }) {
  const scenery = mapSceneryUrl(mapName)
  const [scenes, setScenes] = useState<Scenes>({ over: scenery, under: null })
  // The first picture is in the page from the start and fetched by its own element; it comes in when it has arrived.
  const [first] = useState(scenery)
  const [firstArrived, setFirstArrived] = useState(false)
  const shown = useRef(scenery)

  useEffect(() => {
    if (!scenery || scenery === shown.current) {
      return
    }
    let stale = false
    void loadImage(scenery).then((arrived) => {
      if (arrived && !stale) {
        shown.current = scenery
        setScenes((now) => ({ over: scenery, under: now.over }))
      }
    })
    return () => {
      stale = true
    }
  }, [scenery])

  return (
    // It starts above the section, behind the top bar. How tall the bar is is not known here (on a narrow screen it
    // wraps), so the box starts 160px up, more than the bar ever takes: what is above the top of the page is not drawn.
    <div aria-hidden="true" className="scenery-fade pointer-events-none absolute inset-x-0 -top-40 bottom-0 -z-10">
      {/* One list, keyed by picture: the picture that was coming in stays the same element when it goes underneath. */}
      {[scenes.under, scenes.over].map(
        (url) =>
          url && (
            <img
              key={url}
              src={url}
              alt=""
              decoding="async"
              fetchPriority={url === first ? 'high' : undefined}
              onLoad={url === first ? () => setFirstArrived(true) : undefined}
              className={cn(
                SCENE,
                url === scenes.over && (url !== first || firstArrived ? 'animate-scene-in' : 'opacity-0'),
              )}
            />
          ),
      )}
      <div className="scenery-veil-hero absolute inset-0" />
    </div>
  )
}
