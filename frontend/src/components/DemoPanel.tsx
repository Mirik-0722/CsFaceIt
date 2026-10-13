import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { invalidateDemoResults, useAnalyzeDemo, useDemo, useImportDemo, useUploadDemo } from '@/api/queries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT, type Messages } from '@/i18n'
import { setAdminKey, useAdminKey } from '@/lib/adminKey'
import { errorMessage, reasonText } from '@/lib/errorMessage'
import type { ApiError } from '@/api/client'
import type { DemoStatus } from '@/api/types'

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

/** What a failed action says. A rejected upload is about the file: the backend checks nothing else of the request. */
function failureText(action: Action, error: ApiError, t: Messages): string {
  if (action === 'upload' && error.code === 'VALIDATION_ERROR') {
    return t.demo.invalidFile
  }
  return errorMessage(error, t)
}

/**
 * The demo of a match: its status and the reason of a failure, for everyone; behind "Manage", the requests that need
 * the admin key — import from FACEIT (offered only where it starts something: the match has no demo, or its import
 * failed), upload a file, analyze (again). The key is asked for once and kept in memory until the page is reloaded; a
 * key the backend rejects is forgotten. The panel belongs to one match: render it with the match id as its `key`, so
 * that nothing it remembers follows the visitor to another match.
 */
export default function DemoPanel({ matchId }: { matchId: string }) {
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
  const [failure, setFailure] = useState<{ action: Action; error: ApiError } | null>(null)
  const [accepted, setAccepted] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const storedKey = useAdminKey()
  const apiKey = storedKey ?? typedKey.trim()
  const demo = useDemo(matchId, watching)
  // A demo that FACEIT did not let the site download, or that could not be imported, is fixed by the controls: the
  // explanation sends the visitor to the upload and to the admin key. So the first time the demo is seen in that state
  // the controls are open, and after that the visitor decides (state adjusted while rendering, so that there is no
  // frame with them closed).
  const needsAccess = demo.data?.errorCode === DOWNLOAD_NEEDS_ACCESS
  // The wording of the other codes the page knows; a code it does not know shows the backend's sentence.
  const reason = reasonText(demo.data?.errorCode ?? null, t.demo.reasons)
  const [openedForAccess, setOpenedForAccess] = useState(false)
  if ((needsAccess || demo.data?.errorCode === IMPORT_FAILED) && !openedForAccess) {
    setOpenedForAccess(true)
    setOpen(true)
  }
  const importDemo = useImportDemo(matchId)
  const uploadDemo = useUploadDemo(matchId)
  const analyzeDemo = useAnalyzeDemo(matchId)
  const requests = { import: importDemo, upload: uploadDemo, analyze: analyzeDemo }
  const busy = importDemo.isPending || uploadDemo.isPending || analyzeDemo.isPending
  const disabled = busy || apiKey.length === 0
  const status = demo.data?.status
  // The backend ignores an import request for a parsed or analyzed demo, so the button is not offered there. For a
  // queued or stored demo the request does something once the demo has stood still for ten minutes (it is queued or
  // announced again): the way to revive a demo whose message was lost, so the button stays for those two.
  const canImport = demo.data === null || status === 'FAILED' || status === 'QUEUED' || status === 'STORED'
  const canAnalyze = status === 'PARSED' || status === 'ANALYZED'

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
    setKeyRejected(false)
    setFailure(null)
    setAccepted(false)
    return {
      onSuccess: () => {
        // The backend took the key, so it is the right one: keep it for the next action.
        setAdminKey(apiKey)
        setTypedKey('')
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
        if (error.status === 401) {
          // A rejected key is forgotten everywhere: the stored one, the one still in the field and the one the
          // rejected request keeps in its variables.
          setAdminKey(null)
          setTypedKey('')
          setKeyRejected(true)
          requests[action].reset()
        } else {
          setFailure({ action, error })
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
      {/* A failure the backend gives a code to is explained in the visitor's language (with the way out, where there
          is one); any other is the backend's own words about what went wrong, as they are: a technical message. */}
      <div aria-live="polite">
        {demo.data?.error &&
          (needsAccess ? (
            <div className="flex flex-col items-start gap-0.5 border-t border-border px-4 py-3 text-sm">
              <p className="text-negative">{t.demo.needsAccess}</p>
              <a
                href={`https://www.faceit.com/en/cs2/room/${encodeURIComponent(matchId)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 max-w-full items-center text-foreground underline underline-offset-4 hover:text-muted-foreground"
              >
                {t.demo.needsAccessLink} <span className="sr-only">{t.demo.newTab}</span>
              </a>
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
          {storedKey === null && (
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
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={fileId} className="label-mono">
                {t.demo.fileLabel}
              </label>
              <Input
                ref={fileInput}
                id={fileId}
                type="file"
                accept=".dem,.gz,.zst"
                className="max-w-sm py-2"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={disabled || file === null}
              onClick={() => file && uploadDemo.mutate({ apiKey, file }, callbacks('upload'))}
            >
              {t.demo.upload}
            </Button>
          </div>
          {(canImport || canAnalyze) && (
            <div className="flex flex-wrap gap-3">
              {canImport && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => importDemo.mutate({ apiKey }, callbacks('import'))}
                >
                  {t.demo.importFromFaceit}
                </Button>
              )}
              {canAnalyze && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => analyzeDemo.mutate({ apiKey }, callbacks('analyze'))}
                >
                  {status === 'ANALYZED' ? t.demo.reanalyze : t.demo.analyze}
                </Button>
              )}
            </div>
          )}
          {/* Always in the page, so that its first message is announced; while empty it takes back the gap above. */}
          <div id={messagesId} aria-live="polite" className="text-sm empty:-mt-4">
            {busy && (
              <p className="text-muted-foreground">{uploadDemo.isPending ? t.demo.uploading : t.demo.sending}</p>
            )}
            {keyRejected && <p className="text-destructive">{t.demo.wrongKey}</p>}
            {failure && <p className="text-destructive">{failureText(failure.action, failure.error, t)}</p>}
            {accepted && <p className="text-muted-foreground">{t.demo.accepted}</p>}
          </div>
        </div>
      )}
    </section>
  )
}
