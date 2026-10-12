import type { ClipStatus } from '@/api/types'

/** `DONE` and `FAILED` are where a clip stops; in any other status it is still on its way to a video. */
export function isFinished(status: ClipStatus): boolean {
  return status === 'DONE' || status === 'FAILED'
}
