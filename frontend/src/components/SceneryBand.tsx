import { cn } from '@/lib/utils'

interface SceneryBandProps {
  /** The large view of a map (`mapSceneryUrl`). */
  url: string
  /** Whether the picture has arrived (see `useLoadedUrl`): it fades in then. */
  shown: boolean
  onLoad: () => void
}

/**
 * The scenery of a map behind the header of a page (spec 3, `SceneryBand`). It spans the page's column, from the top
 * bar's line (the page's own 36px of padding above the header) to 36px under the header, and goes over into the page's
 * ground at its bottom: a mask lets the real ground show, as the landing page's backdrop does. A veil in the ground's
 * colour lies over the picture, heavy at the left where the title stands and light at the right where the picture is to
 * be seen. It fades in once the picture has arrived (at once for a visitor who asked for less motion); a phone gets a
 * band behind the first lines instead of the whole height. Nothing here is in the header's flow, so nothing moves when
 * it comes. The header it stands behind is `relative isolate`. Decoration: never announced.
 */
export default function SceneryBand({ url, shown, onLoad }: SceneryBandProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'scenery-fade-head pointer-events-none absolute inset-x-0 -top-9 -bottom-9 -z-10 transition-opacity duration-700 motion-reduce:transition-none max-sm:bottom-auto max-sm:h-40',
        shown ? 'opacity-100' : 'opacity-0',
      )}
    >
      <img src={url} alt="" decoding="async" onLoad={onLoad} className="size-full object-cover object-[50%_35%]" />
      <div className="scenery-veil-head absolute inset-0" />
    </div>
  )
}
