import { Button } from '@/components/ui/button'
import { LOCALES, setLocale, useLocale, useT } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * One button per language: in the top bar from `md` up; on a phone in the footer, for everyone, and in the account
 * menu (spec 3.1 of the phone view). The chosen language is the pressed one: brighter and bolder, so the state is not
 * carried by colour alone. The codes are the languages' own (`UZ`, `EN`), the same in every language. `className` is
 * the place's: the width it is shown at.
 */
export default function LanguageSwitch({ className }: { className?: string }) {
  const t = useT()
  const locale = useLocale()
  return (
    // The glyphs sit in 44px targets with 2px between them; where the group stands is the place's business.
    <div role="group" aria-label={t.language.label} className={cn('flex items-center gap-0.5', className)}>
      {LOCALES.map((code) => (
        <Button
          key={code}
          type="button"
          variant="ghost"
          size="icon"
          aria-pressed={code === locale}
          onClick={() => setLocale(code)}
          className="font-mono text-xs font-normal text-subtle hover:text-foreground aria-pressed:font-semibold aria-pressed:text-foreground"
        >
          {code.toUpperCase()}
        </Button>
      ))}
    </div>
  )
}
