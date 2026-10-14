import type { Messages } from '@/i18n'
import { formatDuration } from '@/lib/highlightLabels'
import type { Problem } from '@/lib/montage'

/** The sentence that says why the montage cannot be ordered as it is (the inspector's summary). */
export function problemText(problem: Problem, t: Messages): string {
  switch (problem.kind) {
    case 'empty':
      return t.montage.problems.empty
    case 'tooManySegments':
      return t.montage.problems.tooManySegments(problem.count, problem.max)
    case 'tooLong':
      return t.montage.problems.tooLong(formatDuration(problem.total), formatDuration(problem.max))
    case 'segmentTooLong':
      return t.montage.problems.segmentTooLong(problem.number, problem.max)
    case 'titleTooLong':
      return t.montage.problems.titleTooLong(problem.max)
  }
}
