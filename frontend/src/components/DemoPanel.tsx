import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { invalidateDemoResults, useAnalyzeDemo, useDemo, useImportDemo, useUploadDemo } from '@/api/queries'
import DemoStages from '@/components/DemoStages'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT, type Messages } from '@/i18n'
import { setAdminKey, useAdminKey } from '@/lib/adminKey'
import { denialText, errorMessage, reasonText } from '@/lib/errorMessage'
import { demoStages } from '@/lib/demoStages'
import { isMatchmakingMatch } from '@/lib/matchSource'
import { nextPossible } from '@/lib/limits'
import { useViewer } from '@/lib/viewer'
import type { ApiError } from '@/api/client'
import type { DemoStatus, MatchResponse } from '@/api/types'

const STATUS_VARIANT: Record<DemoStatus, 'outline' | 'positive' | 'negative'> = {
  QUEUED: 'outline',
  STORED: 'outline',
  PARSED: 'outline',
  ANALYZED: 'positive',
  FAILED: 'negative',
}

/**
 * How long the demo is asked for again after a repeated analysis was requested: the analysis runs in the background
 * and a demo that is already ANALYZED does not change its status while it does.
 */
const WATCH_MS = 30_000

type Action = 'import' | 'upload' | 'analyze'

/** The code of a demo that FACEIT did not let the site download (see `DemoResponse.errorCode`). */
const DOWNLOAD_NEEDS_ACCESS = 'DOWNLOAD_NEEDS_ACCESS'

/** The code of a demo whose import failed on every attempt: the upload is the way out, as it is for the code above. */
const IMPORT_FAILED = 'IMPORT_FAILED'

interface Failure {
  action: Action
  error: ApiError
  /** The request went out with the admin key (and not as the signed-in visitor). */
  withKey: boolean
}

/**
 * What a failed action says. A rejected upload is about the file: the backend checks nothing else of the request. An
 * upload by the session that got no answer at all was most likely refused: the backend refuses before it reads the
 * file and may close the connection, which the browser reports as a network failure.
 */
function failureText({ action, error, withKey }: Failure, t: Messages): string {
  if (action === 'upload' && error.code === 'VALIDATION_ERROR') {
    return t.demo.invalidFile
  }
  if (action === 'upload' && error.code === 'NETWORK_ERROR' && !withKey) {
    return t.demo.uploadInterrupted
  }
  return errorMessage(error, t)
}

interface DemoPanelProps {
  matchId: string
  /** The match itself: its rosters say whether the signed-in visitor is one of its players. */
  match: MatchResponse
}

/**
 * The demo of a match: its status, the stages it goes through and the reason of a failure, for everyone; behind
 * "Manage", the requests that change it — import from FACEIT (offered only where it starts something: the match has no
 * demo, or its import failed; never for a matchmaking match, which FACEIT does not know), upload a file, analyze (again).
 *
 * Who may make them: a signed-in player of the match and an administrator, by the session alone, with no key field in
 * sight (and, for a match without a demo, with the controls already open); anybody with the admin key. A visitor who
 * is not signed in is shown the key field, as before. A signed-in visitor who may not act reads why, and what to do
 * about it; the key field is behind a quiet switch for an operator. A typed key is asked for once and kept in memory
 * until the page is reloaded; a key the backend rejects is forgotten.
 *
 * The panel belongs to one match: render it with the match id as its `key`, so that nothing it remembers follows the
 * visitor to another match.
 */
export default function DemoPanel({ matchId, match }: DemoPanelProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const titleId = useId()
  const controlsId = useId()
  const keyId = useId()
  const fileId = useId()
  const messagesId = useId()

  const [open, setOpen] = useState(false)
  const [typedKey, setTypedKey] = useState('')
  const [file, setFile] = useState<File | null>(null)
  // Until when the demo is watched after a repeated analysis; a second request moves the time on.
  const [watchUntil, setWatchUntil] = useState<number | null>(null)
  const watching = watchUntil !== null
  const [keyRejected, setKeyRejected] = useState(false)
  // The backend refused a request made by the session alone as nobody's: the session has ended since the page asked.
  const [sessionEnded, setSessionEnded] = useState(false)
  // A signed-in visitor opened the key field (an operator's way in where the session is not enough).
  const [keyOpen, setKeyOpen] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [accepted, setAccepted] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const viewer = useViewer()
  const permission = viewer.canManageDemo(match)
  const storedKey = useAdminKey()
  // The field is the way in of a visitor who is not signed in, and of a signed-in one who asked for it. Until it is
  // known who is signed in it is not shown: a member would see it flash.
  const keyField = storedKey === null && !viewer.loading && (!viewer.signedIn || keyOpen)
  // The key that goes with a request: the one the page holds, else what stands in the field while it is shown. With
  // none the request is the signed-in visitor's own.
  const apiKey = storedKey ?? (keyField ? typedKey.trim() : '')
  const withKey = apiKey.length > 0
  // Why the signed-in visitor may not act by the session; null when the visitor may, and for one who is not signed in.
  const denial = denialText(permission.reason, t)
  // The requests are offered to whoever has a way to make them, or a field to type one into.
  const offered = permission.allowed || keyField || storedKey !== null
  // A player of the match, acting by the session: the backend lets a player bring the first demo and have it analyzed
  // once, and leaves replacing a demo that is read, and repeating an analysis, to an administrator.
  const asPlayer = permission.allowed && !viewer.admin && !withKey
  // The day's limits count what a player does by the session. One that is used up is foreseen: the action is off and
  // the panel says from when it is possible again (an upload that is refused may not even get an answer). Without
  // limits in `/auth/me` nothing is claimed.
  const limits = asPlayer ? viewer.limits : null
  const uploadsOut = limits !== null && limits.demoUploads.remaining <= 0
  const importsOut = limits !== null && limits.demoImports.remaining <= 0
  // Whether the instruction of a failed download ("upload the file below") is for this visitor: for whoever may act
  // by the session, and for whoever is on the key path. A signed-in visitor who may not act is told what failed only.
  const instructed = offered
  const demo = useDemo(matchId, watching)
  // A demo that FACEIT did not let the site download, or that could not be imported, is fixed by the controls: the
  // explanation sends the visitor to the upload (and, on the key path, to the admin key). So the first time the demo is
  // seen in that state by a visitor the explanation is for, the controls are open, and after that the visitor decides
  // (state adjusted while rendering, so that there is no frame with them closed).
  const needsAccess = demo.data?.errorCode === DOWNLOAD_NEEDS_ACCESS
  // The wording of the other codes the page knows; a code it does not know shows the backend's sentence.
  const importFailed = demo.data?.errorCode === IMPORT_FAILED
  const reason =
    importFailed && !instructed ? t.demo.importFailedPlain : reasonText(demo.data?.errorCode ?? null, t.demo.reasons)
  const [openedForAccess, setOpenedForAccess] = useState(false)
  if ((needsAccess || importFailed) && !viewer.loading && instructed && !openedForAccess) {
    setOpenedForAccess(true)
    setOpen(true)
  }
  // A match without a demo is where a visitor who may act starts: the controls are open from the first time that is
  // known (the same way, and for the same reason, as above).
  const [openedForStart, setOpenedForStart] = useState(false)
  if (permission.allowed && demo.data === null && !openedForStart) {
    setOpenedForStart(true)
    setOpen(true)
  }
  const importDemo = useImportDemo(matchId)
  const uploadDemo = useUploadDemo(matchId)
  const analyzeDemo = useAnalyzeDemo(matchId)
  const requests = { import: importDemo, upload: uploadDemo, analyze: analyzeDemo }
  const busy = importDemo.isPending || uploadDemo.isPending || analyzeDemo.isPending
  const disabled = busy || !(permission.allowed || withKey)
  const status = demo.data?.status
  // The line of stages is for a demo that is on its way or has failed. One that is analyzed keeps it only when this
  // panel watched it get there, so that the last step is seen to be reached; a match whose demo was ready all along
  // has the tag and nothing more.
  const [sawUnfinished, setSawUnfinished] = useState(false)
  if (status !== undefined && status !== 'ANALYZED' && !sawUnfinished) {
    setSawUnfinished(true)
  }
  // A demo that failed without saying where has no line at all (see `demoStages`).
  const stagesShown =
    demo.data && (status !== 'ANALYZED' || sawUnfinished) && demoStages(demo.data) !== null
  // The backend ignores an import request for a parsed or analyzed demo, so the button is not offered there. For a
  // queued or stored demo the request does something once the demo has stood still for ten minutes (it is queued or
  // announced again): the way to revive a demo whose message was lost, so the button stays for those two.
  // A matchmaking match is not FACEIT's: there is nothing to import from there, its demo comes as a file or a link.
  const matchmaking = isMatchmakingMatch(matchId)
  const canImport =
    !matchmaking && (demo.data === null || status === 'FAILED' || status === 'QUEUED' || status === 'STORED')
  const canAnalyze = status === 'PARSED' || (status === 'ANALYZED' && !asPlayer)
  const canUpload = !(asPlayer && (status === 'PARSED' || status === 'ANALYZED'))

  // What is computed from the demo is asked for again when the demo changes: its status, or the time it was written.
  const stamp = demo.data ? `${demo.data.status} ${demo.data.updatedAt}` : demo.data === null ? 'none' : undefined
  const seenStamp = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (stamp === undefined) {
      return
    }
    if (seenStamp.current !== undefined && seenStamp.current !== stamp) {
      invalidateDemoResults(queryClient, matchId)
    }
    seenStamp.current = stamp
  }, [stamp, queryClient, matchId])

  // A repeated analysis may leave the demo exactly as it was, so while it is watched every answer counts as a change.
  const answeredAt = demo.dataUpdatedAt
  useEffect(() => {
    if (watching) {
      invalidateDemoResults(queryClient, matchId)
    }
  }, [watching, answeredAt, queryClient, matchId])

  useEffect(() => {
    if (watchUntil === null) {
      return
    }
    const timer = setTimeout(() => setWatchUntil(null), Math.max(0, watchUntil - Date.now()))
    return () => clearTimeout(timer)
  }, [watchUntil])

  /** What every action does around its own request. */
  function callbacks(action: Action) {
    // The key this request goes out with, if any: what its answer says is about that key, whatever the field holds
    // by then.
    const sentKey = withKey ? apiKey : null
    setKeyRejected(false)
    setSessionEnded(false)
    setFailure(null)
    setAccepted(false)
    return {
      onSuccess: () => {
        if (sentKey !== null) {
          // The backend took the key, so it is the right one: keep it for the next action.
          setAdminKey(sentKey)
          setTypedKey('')
        }
        setAccepted(true)
        if (action === 'analyze') {
          setWatchUntil(Date.now() + WATCH_MS)
        }
        if (action === 'upload') {
          setFile(null)
          if (fileInput.current) {
            fileInput.current.value = ''
          }
        }
      },
      onError: (error: ApiError) => {
        if (error.status === 401 && sentKey === null) {
          // No key went out, so it is not a key that was refused: the session has ended (signed out in another tab,
          // or run out). The page asks again who is signed in (every write does) and then draws itself for a visitor.
          setSessionEnded(true)
        } else if (error.status === 401) {
          // A rejected key is forgotten everywhere: the stored one, the one still in the field and the one the
          // rejected request keeps in its variables.
          setAdminKey(null)
          setTypedKey('')
          setKeyRejected(true)
          requests[action].reset()
        } else {
          setFailure({ action, error, withKey: sentKey !== null })
        }
      },
    }
  }

  return (
    <section aria-labelledby={titleId} className="border border-border bg-card">
      <div className="flex min-h-14 items-center gap-x-4 py-1.5 pr-2 pl-4">
        <h2 id={titleId} className="label-mono">
          {t.demo.title}
        </h2>
        <div aria-live="polite" className="flex min-w-0 flex-1 items-center">
          {/* One row has no room for a skeleton: the loading text alone, as a mono label (spec 7). */}
          {demo.isPending && <span className="label-mono">{t.demo.loading}</span>}
          {demo.isError && demo.data === undefined && (
            <span className="text-[13px] text-destructive">{errorMessage(demo.error, t)}</span>
          )}
          {demo.data === null && <Badge variant="secondary">{t.demo.none}</Badge>}
          {/* A demo with an error is one that failed, whatever its status: PARSED with one is a failed analysis. */}
          {status && (
            <Badge variant={demo.data?.error ? 'negative' : STATUS_VARIANT[status]}>{t.demo.status[status]}</Badge>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={controlsId}
          onClick={() => setOpen(!open)}
        >
          {t.demo.manage}
        </Button>
      </div>
      {stagesShown && demo.data && (
        // As wide as the panel on a phone; on a wide screen it keeps to the left, where the status it explains is.
        <div className="px-4 pb-3.5">
          <DemoStages demo={demo.data} className="max-w-140" />
        </div>
      )}
      {/* A failure the backend gives a code to is explained in the visitor's language (with the way out, where there
          is one); any other is the backend's own words about what went wrong, as they are: a technical message. */}
      <div aria-live="polite">
        {demo.data?.error &&
          (needsAccess && !instructed ? (
            // A signed-in visitor who may not act, or one not known yet: what failed, and no errand.
            <p className="border-t border-border px-4 py-3 text-sm text-negative">{t.demo.needsAccessPlain}</p>
          ) : needsAccess ? (
            <div className="flex flex-col items-start gap-0.5 border-t border-border px-4 py-3 text-sm">
              {/* Whoever may upload by the session is not sent to the admin key. */}
              <p className="text-negative">{permission.allowed ? t.demo.needsAccessMember : t.demo.needsAccess}</p>
              {/* No FACEIT room behind a matchmaking match: never a link to FACEIT there. */}
              {!matchmaking && (
                <a
                  href={`https://www.faceit.com/en/cs2/room/${encodeURIComponent(matchId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 max-w-full items-center text-foreground underline underline-offset-4 hover:text-muted-foreground"
                >
                  {t.demo.needsAccessLink} <span className="sr-only">{t.demo.newTab}</span>
                </a>
              )}
            </div>
          ) : reason !== null ? (
            <p className="border-t border-border px-4 py-3 text-sm text-negative">{reason}</p>
          ) : (
            <p className="border-t border-border px-4 py-3 font-mono text-xs break-words text-negative">
              {demo.data.error}
            </p>
          ))}
      </div>
      {open && (
        <div id={controlsId} className="flex flex-col gap-4 border-t border-border p-4">
          {/* Until it is known who is signed in: the room of the first row (a label and a field), which is the key
              field of a visitor and the file field of a member, so that neither arrives with a jump. */}
          {viewer.loading && storedKey === null && <div aria-hidden="true" className="h-16" />}
          {/* Why not, before anything else: a signed-in visitor is never left with a bare key field. */}
          {denial !== null && <p className="max-w-190 text-sm leading-normal text-muted-foreground">{denial}</p>}
          {keyField && (
            <div className="flex max-w-sm flex-col gap-1.5">
              <label htmlFor={keyId} className="label-mono">
                {t.demo.adminKey}
              </label>
              <Input
                id={keyId}
                type="password"
                autoComplete="new-password"
                value={typedKey}
                onChange={(event) => setTypedKey(event.target.value)}
                aria-invalid={keyRejected ? true : undefined}
                aria-describedby={messagesId}
              />
            </div>
          )}
          {offered && canUpload && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-0 flex-col gap-1.5">
                <label htmlFor={fileId} className="label-mono">
                  {t.demo.fileLabel}
                </label>
                <Input
                  ref={fileInput}
                  id={fileId}
                  type="file"
                  accept=".dem,.gz,.zst,.bz2"
                  className="max-w-sm py-2"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={disabled || uploadsOut || file === null}
                onClick={() =>
                  file && uploadDemo.mutate({ apiKey: withKey ? apiKey : undefined, file }, callbacks('upload'))
                }
              >
                {t.demo.upload}
              </Button>
            </div>
          )}
          {/* In place of the upload, for a player of a match whose demo is read: what the backend would answer. */}
          {offered && !canUpload && (
            <p className="max-w-190 text-sm leading-normal text-muted-foreground">{t.demo.alreadyParsed}</p>
          )}
          {/* Not a failure: the button above is off, and this is why and until when. */}
          {offered && canUpload && uploadsOut && limits && (
            <p className="-mt-1 max-w-190 text-sm leading-normal">
              {t.limits.UPLOAD_LIMIT_REACHED(nextPossible(limits.demoUploads.resetsAt, t))}
            </p>
          )}
          {offered && (canImport || canAnalyze) && (
            <div className="flex flex-wrap gap-3">
              {canImport && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled || importsOut}
                  onClick={() => importDemo.mutate({ apiKey: withKey ? apiKey : undefined }, callbacks('import'))}
                >
                  {t.demo.importFromFaceit}
                </Button>
              )}
              {canAnalyze && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled || importsOut}
                  onClick={() => analyzeDemo.mutate({ apiKey: withKey ? apiKey : undefined }, callbacks('analyze'))}
                >
                  {status === 'ANALYZED' ? t.demo.reanalyze : t.demo.analyze}
                </Button>
              )}
            </div>
          )}
          {offered && (canImport || canAnalyze) && importsOut && limits && (
            <p className="-mt-1 max-w-190 text-sm leading-normal">
              {t.limits.IMPORT_LIMIT_REACHED(nextPossible(limits.demoImports.resetsAt, t))}
            </p>
          )}
          {/* Always in the page, so that its first message is announced; while empty it takes back the gap above. */}
          <div id={messagesId} aria-live="polite" className="text-sm empty:-mt-4">
            {busy && (
              <p className="text-muted-foreground">{uploadDemo.isPending ? t.demo.uploading : t.demo.sending}</p>
            )}
            {keyRejected && <p className="text-destructive">{t.demo.wrongKey}</p>}
            {sessionEnded && <p className="text-destructive">{t.auth.sessionEnded}</p>}
            {failure && <p className="text-destructive">{failureText(failure, t)}</p>}
            {accepted && <p className="text-muted-foreground">{t.demo.accepted}</p>}
          </div>
          {/* The operator's way in for a signed-in visitor: the key field, which the session makes unnecessary for
              the players of the match and for an administrator. Gone once the page holds a key. */}
          {viewer.signedIn && !viewer.admin && storedKey === null && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={keyOpen}
              className="-ml-3.5 self-start font-normal text-muted-foreground"
              onClick={() => setKeyOpen(!keyOpen)}
            >
              {t.access.useAdminKey}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
