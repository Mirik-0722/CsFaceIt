/**
 * The class that fills the bar of a share of wins: `--positive` from 50% up, `--negative` below it (a bar at 0% has no
 * fill to colour). The share is judged as it is written next to the bar (to the decimal it shows), so a bar never
 * disagrees with its figure: 49.96% is written "50.0%" and is green. The percent beside the bar is what says it in
 * words; the colour is never the only sign.
 */
export function winShareFill(share: number): string {
  const written = Number(share.toFixed(1))
  return written >= 50 ? 'bg-positive' : 'bg-negative'
}
