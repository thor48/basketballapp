import type { StatLine } from './sleeper'

// Points for one stat line under the league's own `scoring_settings`. Sleeper's stat keys and
// scoring keys share names (`pts`, `reb`, `bonus_pt_40p`, ...), so the score is a straight dot
// product. Projections carry no `bonus_*` counts, so projected points miss those small bonuses;
// season totals include them.
export function scoreLine(line: StatLine | undefined, scoring: Record<string, number>) {
  if (!line) return 0
  let total = 0
  for (const [key, weight] of Object.entries(scoring)) {
    const value = line[key]
    if (weight && typeof value === 'number') total += weight * value
  }
  return total
}

// A short legend for the hero, e.g. "PTS 1 · REB 1.5 · AST 2".
const scoringLabels: Record<string, string> = {
  pts: 'PTS',
  reb: 'REB',
  ast: 'AST',
  stl: 'STL',
  blk: 'BLK',
  to: 'TO',
  tpm: '3PM',
  dd: 'DD',
  td: 'TD',
  bonus_pt_40p: '40+ PTS',
  bonus_pt_50p: '50+ PTS',
  bonus_ast_15p: '15+ AST',
  bonus_reb_20p: '20+ REB',
}

export function scoringLegend(scoring: Record<string, number>) {
  return Object.entries(scoringLabels)
    .filter(([key]) => scoring[key])
    .map(([key, label]) => `${label} ${scoring[key] > 0 && key.startsWith('bonus') ? '+' : ''}${scoring[key]}`)
}
