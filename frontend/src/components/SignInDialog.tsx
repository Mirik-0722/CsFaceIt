import { FaceitSignInButton, SteamSignInButton } from '@/components/SignInButtons'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useT } from '@/i18n'

interface SignInDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The sign-in (spec 4, screen 9): what signing in means, the two ways to do it, and the three steps that follow. The
 * panel is the one of the clip order; the ways are the buttons of the hero. Nothing in it asks for a password: the
 * provider's own page does, and the backend never sees it.
 */
export default function SignInDialog({ open, onOpenChange }: SignInDialogProps) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="flex items-center justify-between gap-3">
          <DialogTitle>{t.auth.signIn}</DialogTitle>
          <DialogClose
            render={<Button type="button" variant="ghost" size="icon" className="-my-2 -mr-3 text-muted-foreground" />}
            aria-label={t.auth.close}
          >
            {/* The mockup's own cross: 10px across, a 1.5px line (the library's is 8px with a thinner one). */}
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="size-4">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </DialogClose>
        </div>
        <p className="text-pretty text-muted-foreground">{t.auth.intro}</p>
        <div className="flex flex-col gap-3">
          <SteamSignInButton layout="dialog" />
          <FaceitSignInButton layout="dialog" />
        </div>
        {/* What happens after the click, in order. The figures are for the eye: the list numbers its items already. */}
        <ol role="list" className="flex flex-col gap-2.5 border-t border-border pt-4 text-sm leading-normal">
          {t.auth.steps.map((step, index) => (
            <li key={step} className="grid grid-cols-[28px_minmax(0,1fr)] items-baseline gap-3">
              <span aria-hidden="true" className="font-mono text-xs leading-normal text-subtle">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-auto text-xs leading-normal text-subtle">{t.auth.disclaimer}</p>
      </DialogContent>
    </Dialog>
  )
}
