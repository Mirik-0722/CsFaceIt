import type { DemoResponse } from '@/api/types'

/** The steps a demo goes through on its way to an analysis, in order. */
export const DEMO_STEPS = ['download', 'read', 'analysis', 'ready'] as const

export type DemoStep = (typeof DEMO_STEPS)[number]

/** Where one step is: behind the demo, being worked on, the one it failed at, or still ahead. */
export type DemoStepState = 'done' | 'current' | 'failed' | 'waiting'

/** The step each in-progress status is working on; `ANALYZED` is past the last one. */
const WORKING_ON: Record<string, number> = { QUEUED: 0, STORED: 1, PARSED: 2 }

/**
 * The step a failure belongs to, for the reason codes that tell: the file never arrived, it could not be read (or is
 * another match's, which is found out by reading it), or its analysis failed.
 */
const FAILED_AT: Record<string, number> = {
  DOWNLOAD_NEEDS_ACCESS: 0,
  IMPORT_FAILED: 0,
  PARSE_FAILED: 1,
  WRONG_MATCH: 1,
  ANALYSIS_FAILED: 2,
}

/**
 * The state of each of {@link DEMO_STEPS} for a demo, from its status and the reason of its failure. A failure marks
 * the step its code names; without a telling code, the step the demo was at (a `PARSED` demo with an error is a failed
 * analysis). A `FAILED` demo whose reason tells nothing has no step to mark: the answer is null, there is no line to
 * draw, and the status and the reason beside it say that the demo failed.
 */
export function demoStages(demo: Pick<DemoResponse, 'status' | 'error' | 'errorCode'>): DemoStepState[] | null {
  if (demo.status === 'ANALYZED') {
    return DEMO_STEPS.map(() => 'done')
  }
  const failed = demo.status === 'FAILED' || demo.error !== null
  const working: number | undefined = WORKING_ON[demo.status]
  if (!failed) {
    return DEMO_STEPS.map((_step, index) => (index < working ? 'done' : index === working ? 'current' : 'waiting'))
  }
  const named = demo.errorCode !== null && Object.hasOwn(FAILED_AT, demo.errorCode) ? FAILED_AT[demo.errorCode] : undefined
  const failedAt = named ?? working
  if (failedAt === undefined) {
    return null
  }
  return DEMO_STEPS.map((_step, index) => (index < failedAt ? 'done' : index === failedAt ? 'failed' : 'waiting'))
}
