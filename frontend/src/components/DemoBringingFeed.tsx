import { type Messages, useLocale, useT } from '@/i18n'
import { Button } from '@/components/ui/button'
import { formatMatchTime } from '@/lib/formatDate'
import { mapLabel } from '@/lib/mapTint'
import type { PlayerMatchResponse } from '@/api/overview'
import type { Bringing, BringNotice } from '@/lib/useDemoBringing'

interface DemoBringingFeedProps {
  states: Record<string, Bringing>
  notice: BringNotice | null
  /** The rows that are loaded, to name a match by its map and day. */
  items: PlayerMatchResponse[]
  onDismiss: (matchId: string) => void
  onDismissNotice: () => void
}

/** The match a line is about: its map and day when the row is loaded, else the start of its id. */
function MatchName({ matchId, items }: { matchId: string; items: PlayerMatchResponse[] }) {
  const t = useT()
  const locale = useLocale()
  const row = items.find((match) => match.matchId === matchId)
  return (
    <span className="font-mono text-xs text-subtle">
      {row ? `${mapLabel(row.mapName) ?? t.match.unknownMap} · ${formatMatchTime(row.startedAt, locale)}` : `${matchId.slice(0, 10)}…`}
    </span>
  )
}

/** Why a file or a link is not uploaded, with the way out: the row's button, named as it reads. */
function noticeText(notice: BringNotice, button: string, t: Messages): string {
  return notice.kind === 'noMatchId' ? t.matches.bring.noMatchId(notice.name, button) : t.matches.bring.noLinkId(button)
}

/**
 * What became of the files and links the visitor has brought in, above the rows (so that it is in sight on a phone,
 * where the box is under them): a line per match while it goes (with the percent of an upload), what was refused and
 * why, and a short "sent". It is a live region, so a screen reader hears each as it comes. Nothing is drawn while
 * there is nothing to say.
 */
export default function DemoBringingFeed({ states, notice, items, onDismiss, onDismissNotice }: DemoBringingFeedProps) {
  const t = useT()
  const entries = Object.entries(states)
  return (
    <div role="status" aria-label={t.matches.bring.feedLabel} className="flex flex-col empty:hidden">
      {notice && (
        <div className="flex items-start gap-3 border-b border-border py-2">
          {/* The sentence names the row's button as it reads: "Demo" on a phone (spec of the phone view, 4). */}
          <p className="min-w-0 flex-1 self-center text-sm leading-normal text-negative">
            <span className="max-md:hidden">{noticeText(notice, t.matches.bring.row, t)}</span>
            <span className="md:hidden">{noticeText(notice, t.matches.bring.rowShort, t)}</span>
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={onDismissNotice}>
            {t.matches.bring.dismiss}
          </Button>
        </div>
      )}
      {entries.map(([matchId, state]) => (
        <div key={matchId} className="flex items-center gap-3 border-b border-border py-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <MatchName matchId={matchId} items={items} />
            {state.phase === 'sending' && (
              <>
                {/* Not announced: the percent changes with every chunk, and "Sent" or the failure is what is said. */}
                <p aria-live="off" className="text-sm">
                  {state.percent === null ? t.matches.bring.fetching : t.matches.bring.sending(state.percent)}
                </p>
                {state.percent !== null && (
                  <div
                    role="progressbar"
                    aria-live="off"
                    aria-label={t.matches.bring.sending(state.percent)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={state.percent}
                    className="h-0.5 w-full max-w-60 bg-border"
                  >
                    <div className="h-full bg-foreground" style={{ width: `${state.percent}%` }} />
                  </div>
                )}
              </>
            )}
            {state.phase === 'sent' && <p className="text-sm text-muted-foreground">{t.matches.bring.sent}</p>}
            {state.phase === 'failed' && <p className="text-sm leading-normal text-negative">{state.text(t)}</p>}
          </div>
          {state.phase === 'failed' && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onDismiss(matchId)}>
              {t.matches.bring.dismiss}
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}
