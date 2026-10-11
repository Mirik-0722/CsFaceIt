import { Button } from '@/components/ui/button'
import { LOCALES, setLocale, useLocale, useT } from '@/i18n'

/**
 * One button per language, in the top bar. The chosen language is the pressed one: brighter and bolder, so the state is
 * not carried by colour alone. The codes are the languages' own (`UZ`, `EN`), the same in every language.
 */
export default function LanguageSwitch() {
  const t = useT()
  const locale = useLocale()
  return (
    // `ml-auto` keeps the buttons on the right when the top bar wraps them onto a row of their own. The glyphs sit in
    // 44px targets, so the group is pulled out by 12px (`-mr-3`) to put the last glyph on the page column's edge.
    <div role="group" aria-label={t.language.label} className="-mr-3 ml-auto flex items-center">
      {LOCALES.map((code) => (
        <Button
          key={code}
          type="button"
          variant="ghost"
          size="icon"
          aria-pressed={code === locale}
          onClick={() => setLocale(code)}
          className="font-mono text-xs font-normal tracking-[0.08em] text-muted-foreground hover:text-foreground aria-pressed:font-semibold aria-pressed:text-foreground"
        >
          {code.toUpperCase()}
        </Button>
      ))}
    </div>
  )
}
