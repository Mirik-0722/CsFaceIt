import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { useT } from '@/i18n'
import { highlightGroup, highlightLabel } from '@/lib/highlightLabels'
import { cn } from '@/lib/utils'
import type { HighlightType } from '@/api/types'

/** The tag of a type in its family's colour; an ace, the strongest, is the one filled tag. */
function variantOf(type: HighlightType) {
  if (type === 'ACE') {
    return 'hlAce' as const
  }
  switch (highlightGroup(type)) {
    case 'multi':
      return 'hlMulti' as const
    case 'clutch':
      return 'hlClutch' as const
    default:
      return 'hlSpecial' as const
  }
}

interface HighlightTagProps {
  type: HighlightType
  /** The text when it is more than the type's label (`ACE ×2` in a row of matches); the label by default. */
  children?: ReactNode
  /** Fills an outlined tag with the card's colour, for a tag that stands on a picture. */
  onPicture?: boolean
  className?: string
}

/**
 * The tag of a highlight type (spec 3, `HighlightTag`): its label as it is written (`1v3 CLUTCH`, so the case is left
 * alone), in the colour of its family (multi-kill, clutch, special), which are the groups of the match page's filter.
 * The text says the type, so the colour is never the only sign.
 */
export default function HighlightTag({ type, children, onPicture = false, className }: HighlightTagProps) {
  const t = useT()
  const variant = variantOf(type)
  return (
    <Badge variant={variant} className={cn('normal-case', onPicture && variant !== 'hlAce' && 'bg-card/92', className)}>
      {children ?? highlightLabel(type, t)}
    </Badge>
  )
}
