import FaceitTag from '@/components/FaceitTag'
import { Badge } from '@/components/ui/badge'
import { useT } from '@/i18n'
import { isMatchmakingMatch } from '@/lib/matchSource'

/**
 * Where a match is from (spec 3, the source tag): FACEIT's orange `FACEIT`, or the plain outline `CS2 MM` of a Valve
 * matchmaking match (one tag for Premier, Competitive and Wingman: the backend does not tell them apart). The source is
 * read from the match id, so a backend that does not name it yet is still right. `decorative` hides it from assistive
 * technology, for a list where every row carries it; otherwise a screen reader hears the matchmaking tag in words.
 */
export default function SourceTag({ matchId, decorative = false }: { matchId: string; decorative?: boolean }) {
  return isMatchmakingMatch(matchId) ? <MatchmakingTag decorative={decorative} /> : <FaceitTag decorative={decorative} />
}

/** The tag `CS2 MM` alone: also the tag of a player known only from demos, and of the CS2 link section. */
export function MatchmakingTag({ decorative = false }: { decorative?: boolean }) {
  const t = useT()
  return (
    <Badge variant="outline" aria-hidden={decorative ? 'true' : undefined}>
      <span aria-hidden="true">{t.cs2.tag}</span>
      {!decorative && <span className="sr-only">{t.cs2.tagName}</span>}
    </Badge>
  )
}
