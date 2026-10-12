import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * The line for a visitor whose Steam account has no FACEIT player behind it: the sign-in worked, there is just no
 * profile to open, and searching by nickname still does. A bordered box with the tag of the mockup, one row where it
 * fits and two where it does not.
 */
export default function UnlinkedNotice({ className }: { className?: string }) {
  const t = useT()
  return (
    <div
      role="note"
      className={cn(
        'flex min-h-11 max-w-190 flex-wrap items-center gap-x-4 gap-y-2 border border-border px-4 py-2.5 text-sm leading-normal text-muted-foreground',
        className,
      )}
    >
      <span className="label-mono">{t.auth.unlinkedTag}</span>
      <span>{t.auth.unlinked}</span>
    </div>
  )
}
