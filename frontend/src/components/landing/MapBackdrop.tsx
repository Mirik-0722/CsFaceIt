import { cn } from '@/lib/utils'
import { fade, type SceneStack } from './useSceneStack'

// A little above the centre: the skyline of a map is in the upper half of its picture.
const SCENE = 'absolute inset-0 size-full object-cover object-[50%_40%]'

/**
 * The scenery of the active map behind the top bar and the hero of the landing page (spec 4, screen 1), from the top of
 * the page to the hero's bottom line, under a veil that keeps the copy readable. The hero's section is its frame: it
 * has to be `relative`.
 *
 * It draws the page's stack of pictures (`useSceneStack`): when the map changes, its picture comes in over the one
 * before it (`animate-scene-in`; nothing fades for a visitor who asked for less motion). A picture is shown only once it
 * has arrived: until then the one before it stays. Only the first map's picture is fetched with the page. All of it is
 * decoration: empty `alt`, never announced.
 */
export default function MapBackdrop({ scenes }: { scenes: SceneStack }) {
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
              fetchPriority={url === scenes.first ? 'high' : undefined}
              onLoad={url === scenes.first ? scenes.onFirstArrived : undefined}
              className={cn(SCENE, fade(scenes, url))}
            />
          ),
      )}
      <div className="scenery-veil-hero absolute inset-0" />
    </div>
  )
}
