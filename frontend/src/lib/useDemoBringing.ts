import { useCallback, useEffect, useRef, useState } from 'react'
import { type PlayerMatchResponse, useBringDemoFile, useBringDemoLink } from '@/api/overview'
import { ApiError } from '@/api/client'
import type { Messages } from '@/i18n'
import { matchIdFromDemoLink, matchIdFromDemoName } from '@/lib/demoName'
import { errorMessage } from '@/lib/errorMessage'
import { nextPossible } from '@/lib/limits'
import { useViewer } from '@/lib/viewer'

/** How long "Sent" stays in the feed: the row of the match shows the demo's stages by then. */
const SENT_SHOWN_MS = 6_000

/** Where one demo that the visitor brought in stands. The text of a failure is worked out when it is drawn. */
export type Bringing =
  | { phase: 'sending'; percent: number | null }
  | { phase: 'sent' }
  | { phase: 'failed'; text: (t: Messages) => string }

/** Why a thing the visitor dropped or pasted was not taken at all: the name or link says no match. */
export type BringNotice = { kind: 'noMatchId'; name: string } | { kind: 'noLinkId' }

/** The words of a failed bringing: the upload's own cases first, then whatever the backend's code says. */
function failureText(error: Error, t: Messages, upload: boolean): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return t.auth.sessionEnded
    }
    if (upload && error.code === 'VALIDATION_ERROR') {
      return t.demo.invalidFile
    }
    // The backend refuses an upload before it reads the file and may close the connection: no answer at all.
    if (upload && error.code === 'NETWORK_ERROR') {
      return t.demo.uploadInterrupted
    }
  }
  return errorMessage(error, t)
}

/**
 * What the matches page does to bring demos in, for the signed-in player's own matches: a file for a match (the one the
 * visitor chose for a row, or the one the file's name names), or a pasted link. It tells how each goes, per match, for
 * the rows and the feed to draw, and it refuses at once what the backend would refuse (a demo that has been read, a
 * day's limit that is used up) and what cannot be told which match it is for.
 */
export function useDemoBringing(items: PlayerMatchResponse[] | undefined) {
  const viewer = useViewer()
  // `mutateAsync` and not `mutate`: the callbacks of `mutate` are dropped when another request is made meanwhile, and
  // two files may be on their way at once.
  const { mutateAsync: sendFile } = useBringDemoFile()
  const { mutateAsync: sendLink } = useBringDemoLink()
  const [states, setStates] = useState<Record<string, Bringing>>({})
  const [notice, setNotice] = useState<BringNotice | null>(null)
  // What the callbacks below read, so that they stay the same function between renders (the page's drop listeners hold
  // them): the rows are renewed every few seconds.
  const latest = useRef({ items, viewer })
  useEffect(() => {
    latest.current = { items, viewer }
  })

  useEffect(() => {
    if (!Object.values(states).some((state) => state.phase === 'sent')) {
      return
    }
    const timer = setTimeout(
      () => setStates((all) => Object.fromEntries(Object.entries(all).filter(([, state]) => state.phase !== 'sent'))),
      SENT_SHOWN_MS,
    )
    return () => clearTimeout(timer)
  }, [states])

  const put = useCallback((matchId: string, state: Bringing) => setStates((all) => ({ ...all, [matchId]: state })), [])

  /** What the backend would refuse before anything is sent; null when nothing stands in the way. */
  const refusal = useCallback((matchId: string, kind: 'demoUploads' | 'demoImports'): ((t: Messages) => string) | null => {
    const { items: rows, viewer: who } = latest.current
    if (who.admin) {
      return null
    }
    const row = rows?.find((match) => match.matchId === matchId)
    if (row && (row.demoStatus === 'PARSED' || row.demoStatus === 'ANALYZED')) {
      return (t) => t.demo.alreadyParsed
    }
    const limit = who.limits?.[kind]
    if (limit && limit.remaining <= 0) {
      const code = kind === 'demoUploads' ? 'UPLOAD_LIMIT_REACHED' : 'IMPORT_LIMIT_REACHED'
      return (t) => t.limits[code](nextPossible(limit.resetsAt, t))
    }
    return null
  }, [])

  /**
   * Uploads a file. For a row's own action the match is given; for a file that was dropped or chosen in the box it is
   * the one the name names.
   */
  const bringFile = useCallback(
    (file: File, forMatchId?: string) => {
      const matchId = forMatchId ?? matchIdFromDemoName(file.name)
      if (matchId === null) {
        setNotice({ kind: 'noMatchId', name: file.name })
        return
      }
      setNotice(null)
      const refused = refusal(matchId, 'demoUploads')
      if (refused) {
        put(matchId, { phase: 'failed', text: refused })
        return
      }
      put(matchId, { phase: 'sending', percent: 0 })
      sendFile({ matchId, file, onProgress: (percent) => put(matchId, { phase: 'sending', percent }) }).then(
        () => put(matchId, { phase: 'sent' }),
        (error: Error) => put(matchId, { phase: 'failed', text: (t) => failureText(error, t, true) }),
      )
    },
    [put, refusal, sendFile],
  )

  /** Has the backend fetch the demo that a pasted link points to; the match is the one the link's file names. */
  const bringLink = useCallback(
    (link: string) => {
      const matchId = matchIdFromDemoLink(link)
      if (matchId === null) {
        setNotice({ kind: 'noLinkId' })
        return
      }
      setNotice(null)
      const refused = refusal(matchId, 'demoImports')
      if (refused) {
        put(matchId, { phase: 'failed', text: refused })
        return
      }
      put(matchId, { phase: 'sending', percent: null })
      sendLink({ matchId, url: link.trim() }).then(
        () => put(matchId, { phase: 'sent' }),
        (error: Error) => put(matchId, { phase: 'failed', text: (t) => failureText(error, t, false) }),
      )
    },
    [put, refusal, sendLink],
  )

  const dismiss = useCallback((matchId: string) => {
    setStates((all) => Object.fromEntries(Object.entries(all).filter(([id]) => id !== matchId)))
  }, [])

  return { states, notice, dismissNotice: () => setNotice(null), dismiss, bringFile, bringLink }
}
