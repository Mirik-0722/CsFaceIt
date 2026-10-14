/**
 * Whether a share of wins is good or bad news: from 50% up it is, below it is not. The share is judged as it is written
 * (to the decimal it shows), so a colour never disagrees with its figure: 49.96% is written "50.0%" and is good news.
 */
export function winShareTone(share: number): 'positive' | 'negative' {
  return Number(share.toFixed(1)) >= 50 ? 'positive' : 'negative'
}

/**
 * The class that fills the bar of a share of wins: `--positive` from 50% up, `--negative` below it (a bar at 0% has no
 * fill to colour), judged as {@link winShareTone} judges it. The percent beside the bar is what says it in words; the
 * colour is never the only sign.
 */
export function winShareFill(share: number): string {
  return winShareTone(share) === 'positive' ? 'bg-positive' : 'bg-negative'
}
