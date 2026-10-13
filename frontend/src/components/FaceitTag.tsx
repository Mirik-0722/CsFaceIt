import { Badge } from '@/components/ui/badge'

/**
 * Where a match is from: the tag `FACEIT` in FACEIT's own orange (every match of the site comes from there). The name
 * is the same in every language. `decorative` hides it from assistive technology, for a list where every row carries
 * it and it would be heard once per row.
 */
export default function FaceitTag({ decorative = false }: { decorative?: boolean }) {
  return (
    <Badge variant="faceit" aria-hidden={decorative ? 'true' : undefined}>
      FACEIT
    </Badge>
  )
}
