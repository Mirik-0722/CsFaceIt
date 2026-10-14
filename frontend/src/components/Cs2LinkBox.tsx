import { Eye, EyeOff } from 'lucide-react'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { type Cs2LinkResponse, useCs2Link, useCs2LinkWrites } from '@/api/cs2'
import { ApiError } from '@/api/client'
import { MatchmakingTag } from '@/components/SourceTag'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLocale, useT, type Messages } from '@/i18n'
import { errorMessage } from '@/lib/errorMessage'
import { formatMatchTime } from '@/lib/formatDate'
import { cn } from '@/lib/utils'

/** Steam's page where a player makes both codes (the authentication code and the last match sharing code). */
const STEAM_CODES_URL = 'https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128'

/** The form of an authentication code, once spaces are dropped and the letters are upper case: `AAAA-AAAAA-AAAA`. */
const AUTH_CODE = /^[A-Z0-9]{4}-[A-Z0-9]{5}-[A-Z0-9]{4}$/

/** The form of a match sharing code: `CSGO-` and five groups of five letters or digits. */
const SHARE_CODE = /^CSGO(?:-[A-Za-z0-9]{5}){5}$/

/** A text that is worked out when it is drawn, so that it follows a change of language. */
type Text = (t: Messages) => string

interface FormErrors {
  auth: Text | null
  share: Text | null
  /** A failure of the request that is about neither field. */
  form: Text | null
}

const NO_ERRORS: FormErrors = { auth: null, share: null, form: null }

/** What a refused link says, and under which field. */
function errorsOf(error: unknown): FormErrors {
  if (error instanceof ApiError) {
    if (error.code === 'CS2_AUTH_CODE_REFUSED') {
      return { ...NO_ERRORS, auth: (t) => t.cs2.authRefused }
    }
    if (error.code === 'CS2_SHARE_CODE_REFUSED') {
      return { ...NO_ERRORS, share: (t) => t.cs2.shareRefused }
    }
    if (error.status === 401) {
      return { ...NO_ERRORS, form: (t) => t.auth.sessionEnded }
    }
  }
  return { ...NO_ERRORS, form: (t) => errorMessage(error instanceof Error ? error : new Error(String(error)), t) }
}

/**
 * The two codes and the button that links them (spec 3, `Cs2LinkBox`). The authentication code is a secret: it is in
 * the field while it is typed, and leaves the field and every state of the page the moment it is sent, whatever the
 * answer; it is never stored anywhere. Both codes are checked for their form first, and nothing is sent while one is
 * wrong. A refused code is said under its own field.
 */
function LinkForm({ userId, submitLabel }: { userId: number; submitLabel: string }) {
  const t = useT()
  const authId = useId()
  const shareId = useId()
  const authErrorId = useId()
  const shareErrorId = useId()
  const { link } = useCs2LinkWrites(userId)
  const [authCode, setAuthCode] = useState('')
  const [shareCode, setShareCode] = useState('')
  const [shown, setShown] = useState(false)
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)
  const [sending, setSending] = useState(false)
  const authInput = useRef<HTMLInputElement>(null)
  const shareInput = useRef<HTMLInputElement>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const auth = authCode.replace(/\s+/g, '').toUpperCase()
    const share = shareCode.replace(/\s+/g, '').replace(/^csgo-/i, 'CSGO-')
    const authWrong = !AUTH_CODE.test(auth)
    const shareWrong = !SHARE_CODE.test(share)
    if (authWrong || shareWrong) {
      setErrors({
        auth: authWrong ? (text) => text.cs2.authFormat : null,
        share: shareWrong ? (text) => text.cs2.shareFormat : null,
        form: null,
      })
      ;(authWrong ? authInput : shareInput).current?.focus()
      return
    }
    // The secret leaves the page as it is sent: the field is emptied (and hidden again) before the answer comes.
    setAuthCode('')
    setShown(false)
    setShareCode(share)
    setErrors(NO_ERRORS)
    setSending(true)
    try {
      await link({ authCode: auth, shareCode: share })
      setShareCode('')
    } catch (error) {
      const found = errorsOf(error)
      setErrors(found)
      // The field the refusal is about takes the focus; the authentication code has to be typed again anyway.
      if (found.share) {
        shareInput.current?.focus()
      } else if (found.auth) {
        authInput.current?.focus()
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={authId} className="label-mono">
          {t.cs2.authLabel}
        </label>
        <div className="flex gap-2">
          <Input
            ref={authInput}
            id={authId}
            type={shown ? 'text' : 'password'}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder={t.cs2.authPlaceholder}
            value={authCode}
            disabled={sending}
            onChange={(event) => setAuthCode(event.target.value)}
            aria-invalid={errors.auth ? true : undefined}
            aria-describedby={errors.auth ? authErrorId : undefined}
            // 16px on a phone: a smaller text makes it zoom in when the field is focused.
            className="font-mono text-base sm:text-sm"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={shown ? t.cs2.hideCode : t.cs2.showCode}
            aria-pressed={shown}
            onClick={() => setShown(!shown)}
          >
            {shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </Button>
        </div>
        {errors.auth && (
          <p id={authErrorId} className="text-[13px] leading-normal text-negative">
            {errors.auth(t)}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={shareId} className="label-mono">
          {t.cs2.shareLabel}
        </label>
        <Input
          ref={shareInput}
          id={shareId}
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={t.cs2.sharePlaceholder}
          value={shareCode}
          disabled={sending}
          onChange={(event) => setShareCode(event.target.value)}
          aria-invalid={errors.share ? true : undefined}
          aria-describedby={errors.share ? shareErrorId : undefined}
          className="font-mono text-base sm:text-sm"
        />
        {errors.share && (
          <p id={shareErrorId} className="text-[13px] leading-normal text-negative">
            {errors.share(t)}
          </p>
        )}
      </div>
      <a
        href={STEAM_CODES_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="-my-1.5 inline-flex min-h-11 max-w-full items-center self-start text-sm text-foreground underline underline-offset-4 hover:text-muted-foreground"
      >
        {t.cs2.codesLink} <span className="sr-only">{t.demo.newTab}</span>
      </a>
      <Button type="submit" className="self-start" disabled={sending}>
        {sending ? t.cs2.linking : submitLabel}
      </Button>
      {errors.form && <p className="text-sm leading-normal text-destructive">{errors.form(t)}</p>}
    </form>
  )
}

/** "Unlink", with the second click that confirms it (as a clip card's "Cancel"); the matches it brought stay. */
function UnlinkControl({ userId }: { userId: number }) {
  const t = useT()
  const { unlink } = useCs2LinkWrites(userId)
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<Text | null>(null)
  // "Unlink" comes back when the visitor answers "No": the focus returns to it, not to the page's start.
  const unlinkButton = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)
  useEffect(() => {
    if (!confirming && refocus.current) {
      refocus.current = false
      unlinkButton.current?.focus()
    }
  }, [confirming])

  async function confirm() {
    setSending(true)
    setFailure(null)
    try {
      await unlink()
    } catch (error) {
      setConfirming(false)
      setFailure(() => errorsOf(error).form)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-3.5">
      {confirming ? (
        <div role="group" aria-label={t.cs2.unlinkQuestion} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="mr-1 text-sm">{t.cs2.unlinkQuestion}</span>
          <Button type="button" variant="outline" size="sm" disabled={sending} onClick={() => void confirm()}>
            {t.cs2.unlinkYes}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            autoFocus
            disabled={sending}
            onClick={() => {
              refocus.current = true
              setConfirming(false)
            }}
          >
            {t.cs2.unlinkNo}
          </Button>
        </div>
      ) : (
        <Button
          ref={unlinkButton}
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-3.5 self-start font-normal text-muted-foreground"
          onClick={() => setConfirming(true)}
        >
          {t.cs2.unlink}
        </Button>
      )}
      {failure && <p className="text-[13px] leading-normal text-negative">{failure(t)}</p>}
    </div>
  )
}

/** A link's state: a word with a dot, and what to do about it; a bad code brings the form back. */
function LinkState({ userId, link }: { userId: number; link: Cs2LinkResponse }) {
  const t = useT()
  const locale = useLocale()
  const bad = link.state === 'BAD_AUTH_CODE' || link.state === 'BAD_SHARE_CODE'
  const title =
    link.state === 'ACTIVE'
      ? t.cs2.active
      : link.state === 'BAD_AUTH_CODE'
        ? t.cs2.badAuthTitle
        : link.state === 'BAD_SHARE_CODE'
          ? t.cs2.badShareTitle
          : t.cs2.linked
  return (
    <>
      <p className="flex items-start gap-2.5 text-[17px] leading-snug font-semibold">
        <span
          aria-hidden="true"
          className={cn('mt-2 size-2 shrink-0 rounded-full', bad ? 'bg-negative' : 'bg-positive')}
        />
        {title}
      </p>
      {link.state === 'ACTIVE' && (
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t.cs2.checkedAt}</dt>
          <dd className="text-right font-mono text-[13px]">
            {link.checkedAt ? (
              <time dateTime={link.checkedAt}>{formatMatchTime(link.checkedAt, locale)}</time>
            ) : (
              t.cs2.notYet
            )}
          </dd>
          <dt className="text-muted-foreground">{t.cs2.linkedAt}</dt>
          <dd className="text-right font-mono text-[13px]">
            <time dateTime={link.linkedAt}>{formatMatchTime(link.linkedAt, locale)}</time>
          </dd>
        </dl>
      )}
      {bad && (
        <>
          <p className="text-sm leading-normal text-muted-foreground">
            {link.state === 'BAD_AUTH_CODE' ? t.cs2.badAuthText : t.cs2.badShareText}
          </p>
          <LinkForm userId={userId} submitLabel={t.cs2.relink} />
        </>
      )}
      <UnlinkControl userId={userId} />
    </>
  )
}

/**
 * The section of the matches page that links the visitor's CS2 matchmaking games (spec 3, `Cs2LinkBox`): once linked,
 * the demos of new Premier, Competitive and Wingman matches come by themselves. For the signed-in visitor's own page
 * only; `userId` is the visitor's. Nothing is drawn while it is not known whether the feature is on (it is off on a
 * server without the Steam settings, and then the section never shows), nor when it is off.
 */
export default function Cs2LinkBox({ userId }: { userId: number }) {
  const t = useT()
  const query = useCs2Link(userId)
  const state = query.data
  if (state?.kind === 'disabled' || (state === undefined && !query.isError)) {
    return null
  }
  return (
    <section className="flex flex-col gap-3.5 border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="label-mono font-medium">{t.cs2.title}</h2>
        <MatchmakingTag decorative />
      </div>
      {/* What a write changes is announced: the new state, and the reason a code was refused. */}
      <div aria-live="polite" className="flex flex-col gap-3.5">
        {state?.kind === 'unlinked' && (
          <>
            <p className="text-sm leading-normal text-muted-foreground">{t.cs2.intro}</p>
            <LinkForm userId={userId} submitLabel={t.cs2.link} />
          </>
        )}
        {state?.kind === 'linked' && <LinkState userId={userId} link={state.link} />}
        {query.isError && !state && <p className="text-sm text-destructive">{errorMessage(query.error, t)}</p>}
      </div>
    </section>
  )
}
