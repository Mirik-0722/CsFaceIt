import { useState, type ReactNode } from 'react'
import { mapSceneryUrl } from '@/lib/mapArt'
import { mapScene } from '@/lib/mapTint'
import { cn } from '@/lib/utils'

interface ViewfinderFrameProps {
  /** The map the frame is tinted for (spec 2.1); null gives the neutral scene. */
  mapName: string | null
  /** A still of the video, laid over the scene. While there is none, or when it does not load, the scene shows. */
  imageUrl?: string | null
  /**
   * Whether a frame without a still shows the map itself: the small view of the map under a dark veil, for a map that
   * has one. `false` keeps the tinted scene whatever the map (the landing page's sample frame, which is a drawing).
   */
  scenery?: boolean
  /**
   * A picture of the caller's own that fills the frame under the brackets and the labels (the landing page's sample: a
   * moving scenery, or a video), laid over the scene and the still. It brings its own veil.
   */
  picture?: ReactNode
  /**
   * `card` is the frame of a clip card (12px brackets), `large` the frame of a page (18px brackets). `clip` is the
   * frame of the clip's own page: `large` on a desktop, but on a phone, where the frame runs from edge to edge, 14px
   * brackets nearer the corners and 11px labels (the phone board), and on a desktop its labels stand as far from the
   * sides as the board's do (up to 50px).
   */
  size?: 'card' | 'large' | 'clip'
  /** Where the clip is from, such as `MIRAGE · R14`. */
  topLeft?: ReactNode
  topRight?: ReactNode
  /** The play mark, a percentage or a status. */
  center?: ReactNode
  bottomLeft?: ReactNode
  bottomRight?: ReactNode
  /**
   * Makes the whole picture start something: a click anywhere on the frame (not a second control, so nothing is added
   * for the keyboard or a screen reader; the `center` button stays the one control that says what it does).
   */
  onClick?: () => void
  className?: string
}

// The four corners of a camera viewfinder: where each bracket sits and which two of its sides are drawn.
const BRACKETS = [
  'top-0 left-0 border-t-2 border-l-2',
  'top-0 right-0 border-t-2 border-r-2',
  'bottom-0 left-0 border-b-2 border-l-2',
  'right-0 bottom-0 border-r-2 border-b-2',
]

// What differs by size: the label's height and type, how far the brackets stand from the edge, and where each of the
// four labels stands (beside its bracket).
const SIZES = {
  card: {
    label: 'h-3 text-[10px]',
    inset: 'inset-2.5',
    bracket: 'size-3',
    topLeft: 'top-2.5 left-7.5',
    topRight: 'top-2.5 right-7.5',
    bottomLeft: 'bottom-2.5 left-7.5',
    bottomRight: 'right-7.5 bottom-2.5',
  },
  large: {
    label: 'h-4.5 text-xs',
    inset: 'inset-4',
    bracket: 'size-4.5',
    topLeft: 'top-4 left-11',
    topRight: 'top-4 right-11',
    bottomLeft: 'bottom-4 left-11',
    bottomRight: 'right-11 bottom-4',
  },
  clip: {
    label: 'h-4 text-[11px] sm:h-4.5 sm:text-xs',
    inset: 'inset-3 sm:inset-4',
    bracket: 'size-3.5 sm:size-4.5',
    topLeft: 'top-[11px] left-9 sm:top-4 sm:left-[clamp(34px,3.6vw,50px)]',
    topRight: 'top-[11px] right-9 sm:top-4 sm:right-[clamp(34px,3.6vw,50px)]',
    bottomLeft: 'bottom-[11px] left-9 sm:bottom-4 sm:left-[clamp(34px,3.6vw,50px)]',
    bottomRight: 'right-9 bottom-[11px] sm:right-[clamp(34px,3.6vw,50px)] sm:bottom-4',
  },
} as const

/**
 * A 16:9 camera frame (spec 3): the scene of the map as the background, a bracket in each corner, and five places for
 * what is said about the picture. The labels beside the brackets are mono and upper case. The picture in the frame is
 * the still of the video; without one, the view of the map; without that, the scene alone.
 */
export default function ViewfinderFrame({
  mapName,
  imageUrl,
  scenery = true,
  picture,
  size = 'card',
  topLeft,
  topRight,
  center,
  bottomLeft,
  bottomRight,
  onClick,
  className,
}: ViewfinderFrameProps) {
  // The url that failed to load, so that a new url is tried again.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)
  const still = imageUrl && imageUrl !== brokenUrl ? imageUrl : null
  const view = scenery && !still ? mapSceneryUrl(mapName, 'small') : null
  const place = SIZES[size]
  const label = cn(
    'absolute z-10 flex items-center font-mono tracking-[0.08em] text-foreground uppercase',
    place.label,
  )
  return (
    <div
      onClick={onClick}
      className={cn('relative aspect-video overflow-hidden bg-[#0E1013]', onClick && 'cursor-pointer', className)}
      style={{
        backgroundImage: `radial-gradient(90% 80% at 35% 45%, ${mapScene(mapName)} 0%, #15130F 50%, #0E1013 82%)`,
      }}
    >
      {view && (
        <>
          <img src={view} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
          {/* The view is behind what the frame says, not the thing to look at: it lies under a veil. */}
          <div aria-hidden="true" className="scenery-veil-frame absolute inset-0" />
        </>
      )}
      {still && (
        <>
          <img
            src={still}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover"
            onError={() => setBrokenUrl(still)}
          />
          {/* A still can be bright anywhere; the labels in the corners stay readable on a darkened top and bottom. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-linear-to-b from-background/70 via-transparent via-35% to-background/70"
          />
        </>
      )}
      {picture}
      <div aria-hidden="true" className={cn('pointer-events-none absolute', place.inset)}>
        {BRACKETS.map((corner) => (
          <span key={corner} className={cn('absolute border-foreground', place.bracket, corner)} />
        ))}
      </div>
      {topLeft && <div className={cn(label, place.topLeft)}>{topLeft}</div>}
      {topRight && <div className={cn(label, place.topRight)}>{topRight}</div>}
      {bottomLeft && <div className={cn(label, place.bottomLeft)}>{bottomLeft}</div>}
      {bottomRight && (
        // The quality is written as it is said (`1080p`), so this one label keeps its case.
        <div className={cn(label, 'text-muted-foreground normal-case', place.bottomRight)}>{bottomRight}</div>
      )}
      {center && <div className="absolute inset-0 flex items-center justify-center">{center}</div>}
    </div>
  )
}
