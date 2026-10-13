import { Badge } from '@/components/ui/badge'

/**
 * Where a match is from: the tag `FACEIT` in FACEIT's own orange (every match of the site comes from there). The name
 * is the same in every language.
 */
export default function FaceitTag() {
  return <Badge variant="faceit">FACEIT</Badge>
}
