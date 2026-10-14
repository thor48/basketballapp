import type { ExpertRanks, ProjectionSource } from './rankings'
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

// Cons FP/G: Sleeper's per-game projection averaged with ESPN's and FantasyPros', all in league
// scoring. The board, the lineup page and the lock alerts all value a player by it. ESPN and
// FantasyPros project no double- or triple-doubles, so each borrows Sleeper's rate for the player;
// otherwise those 2 and 5 point bonuses would read as a gap between sources.
export function projectedPerGame(sleeperLine: StatLine, projections: ExpertRanks['projections'], scoring: Record<string, number>) {
  const sleeper = scoreLine(sleeperLine, scoring) / (sleeperLine.gp || 1)
  const sources: Partial<Record<ProjectionSource, number>> = {}
  for (const [source, line] of Object.entries(projections ?? {}) as [ProjectionSource, StatLine | undefined][]) {
    if (line) sources[source] = scoreLine({ ...line, dd: sleeperLine.dd ?? 0, td: sleeperLine.td ?? 0 }, scoring)
  }
  const all = [sleeper, ...Object.values(sources)]
  return { sleeper, sources, consensus: all.reduce((sum, value) => sum + value, 0) / all.length }
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
