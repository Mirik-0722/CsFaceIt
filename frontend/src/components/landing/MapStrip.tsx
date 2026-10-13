import { Pause, Play } from 'lucide-react'
import { useId } from 'react'
import MapEmblem from '@/components/MapEmblem'
import { useT } from '@/i18n'
import { mapLabel } from '@/lib/mapTint'
import { cn } from '@/lib/utils'
import { HERO_MAPS, TURN_MS, type MapTurn } from './useMapTurn'

/**
 * The strip of maps at the foot of the landing page's hero (spec 4, screen 1): a mono label and a button per map, the
 * emblem with the map's name. The active map is the pressed one: at full strength, with a 2px light line under it that
 * fills from the left over the map's turn (it stands full when nothing turns). The others are dimmed. Pressing a map
 * makes it the active one and stops the turning; the icon button at the end stops it and lets it go on. From `xl` up
 * the strip is one row; under that the label has a row of its own, with the icon button at its end, and on a phone the
 * maps stand in rows of four, the emblem above the name.
 */
export default function MapStrip({ turn, className }: { turn: MapTurn; className?: string }) {
  const t = useT()
  const labelId = useId()
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className={cn('relative flex flex-col gap-x-8 gap-y-1 xl:flex-row xl:items-center', className)}
      {...turn.hold}
    >
      {/* As tall as the icon button that stands at the end of its row. */}
      <p id={labelId} className="label-mono flex min-h-11 items-center whitespace-nowrap">
        {t.home.maps.label}
      </p>
      <div className="grid grid-cols-4 gap-x-1 gap-y-1 sm:flex sm:flex-wrap sm:gap-x-6 xl:gap-x-7">
        {HERO_MAPS.map((mapName, index) => {
          const active = index === turn.active
          return (
            <button
              key={mapName}
              type="button"
              aria-pressed={active}
              onClick={() => turn.select(index)}
              className="group relative flex min-h-13 min-w-0 flex-col items-center justify-center gap-1.5 rounded-xs pt-1.5 pb-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground aria-pressed:text-foreground sm:flex-row sm:gap-2.5 sm:text-sm"
            >
              <MapEmblem
                mapName={mapName}
                size={40}
                className="opacity-60 group-hover:opacity-100 group-aria-pressed:opacity-100 max-sm:size-8"
              />
              {mapLabel(mapName)}
              {active && (
                // The line's track, and on it the line: it grows while the turn runs, waits where it is while the
                // turn is held, and stands full when the maps do not turn. Only the active map has one, so each turn
                // starts it anew.
                <span aria-hidden="true" className="absolute inset-x-0 bottom-0 block h-0.5 bg-line-strong">
                  <span
                    className={cn('block h-full origin-left bg-foreground', turn.turning && 'animate-turn')}
                    style={{
                      animationDuration: `${TURN_MS}ms`,
                      animationPlayState: turn.running ? 'running' : 'paused',
                    }}
                  />
                </span>
              )}
            </button>
          )
        })}
      </div>
      {/* What the press does is the name; that the turning is stopped is the pressed state. */}
      <button
        type="button"
        aria-pressed={!turn.turning}
        aria-label={turn.turning ? t.home.maps.stop : t.home.maps.resume}
        onClick={turn.toggle}
        className="absolute top-0 right-0 flex size-11 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-secondary hover:text-foreground xl:static xl:ml-auto"
      >
        {turn.turning ? (
          <Pause aria-hidden="true" className="size-3.5" />
        ) : (
          <Play aria-hidden="true" className="size-3.5" />
        )}
      </button>
    </div>
  )
}
