import { useState, type ReactNode } from 'react'
import { mapScene } from '@/lib/mapTint'
import { cn } from '@/lib/utils'

interface ViewfinderFrameProps {
  /** The map the frame is tinted for (spec 2.1); null gives the neutral scene. */
  mapName: string | null
  /** A still of the video, laid over the scene. While there is none, or when it does not load, the scene shows. */
  imageUrl?: string | null
  /**
   * `card` is the frame of a clip card (12px brackets), `large` the frame of a page: 18px brackets, and on a phone,
   * where the frame runs from edge to edge, 14px brackets nearer the corners (the phone board).
   */
  size?: 'card' | 'large'
  /** Where the clip is from, such as `MIRAGE · R14`. */
  topLeft?: ReactNode
  topRight?: ReactNode
  /** The play mark, a percentage or a status. */
  center?: ReactNode
  bottomLeft?: ReactNode
  bottomRight?: ReactNode
  className?: string
}

// The four corners of a camera viewfinder: where each bracket sits and which two of its sides are drawn.
const BRACKETS = [
  'top-0 left-0 border-t-2 border-l-2',
  'top-0 right-0 border-t-2 border-r-2',
  'bottom-0 left-0 border-b-2 border-l-2',
  'right-0 bottom-0 border-r-2 border-b-2',
]

/**
 * A 16:9 camera frame (spec 3): the scene of the map as the background, a bracket in each corner, and five places for
 * what is said about the picture. The labels beside the brackets are mono and upper case.
 */
export default function ViewfinderFrame({
  mapName,
  imageUrl,
  size = 'card',
  topLeft,
  topRight,
  center,
  bottomLeft,
  bottomRight,
  className,
}: ViewfinderFrameProps) {
  // The url that failed to load, so that a new url is tried again.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)
  const large = size === 'large'
  const label = cn(
    'absolute z-10 flex items-center font-mono tracking-[0.08em] text-foreground uppercase',
    large ? 'h-4 text-[11px] sm:h-4.5 sm:text-xs' : 'h-3 text-[10px]',
  )
  // How far the labels stand from the sides (past the bracket) and from the top and bottom; the large frame's side
  // distance grows with the viewport up to 50px, as the board's does.
  const top = large ? 'top-[11px] sm:top-4' : 'top-2.5'
  const bottom = large ? 'bottom-[11px] sm:bottom-4' : 'bottom-2.5'
  const side = large ? '[--edge:36px] sm:[--edge:clamp(34px,3.6vw,50px)]' : '[--edge:30px]'
  return (
    <div
      className={cn('relative aspect-video overflow-hidden bg-[#0E1013]', className)}
      style={{
        backgroundImage: `radial-gradient(90% 80% at 35% 45%, ${mapScene(mapName)} 0%, #15130F 50%, #0E1013 82%)`,
      }}
    >
      {imageUrl && imageUrl !== brokenUrl && (
        <>
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover"
            onError={() => setBrokenUrl(imageUrl)}
          />
          {/* A still can be bright anywhere; the labels in the corners stay readable on a darkened top and bottom. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-linear-to-b from-background/70 via-transparent via-35% to-background/70"
          />
        </>
      )}
      <div
        aria-hidden="true"
        className={cn('pointer-events-none absolute', large ? 'inset-3 sm:inset-4' : 'inset-2.5')}
      >
        {BRACKETS.map((corner) => (
          <span
            key={corner}
            className={cn('absolute border-foreground', large ? 'size-3.5 sm:size-4.5' : 'size-3', corner)}
          />
        ))}
      </div>
      {topLeft && <div className={cn(label, side, 'left-(--edge)', top)}>{topLeft}</div>}
      {topRight && <div className={cn(label, side, 'right-(--edge)', top)}>{topRight}</div>}
      {bottomLeft && <div className={cn(label, side, 'left-(--edge)', bottom)}>{bottomLeft}</div>}
      {bottomRight && (
        // The quality is written as it is said (`1080p`), so this one label keeps its case.
        <div className={cn(label, side, 'right-(--edge) text-muted-foreground normal-case', bottom)}>{bottomRight}</div>
      )}
      {center && <div className="absolute inset-0 flex items-center justify-center">{center}</div>}
    </div>
  )
}
