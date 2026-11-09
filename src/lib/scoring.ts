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
// otherwise those 2 and 5 point bonuses would read as a gap between sources. Sleeper projects
// nothing for some players (rookies, veterans back from a long injury); they are valued on ESPN's
// and FantasyPros' numbers alone, with no double-double rate to borrow.
export function projectedPerGame(sleeperLine: StatLine | undefined, projections: ExpertRanks['projections'], scoring: Record<string, number>) {
  const sleeper = sleeperLine?.pts ? scoreLine(sleeperLine, scoring) / (sleeperLine.gp || 1) : null
  const sources: Partial<Record<ProjectionSource, number>> = {}
  for (const [source, line] of Object.entries(projections ?? {}) as [ProjectionSource, StatLine | undefined][]) {
    if (line) sources[source] = scoreLine({ ...line, dd: sleeperLine?.dd ?? 0, td: sleeperLine?.td ?? 0 }, scoring)
  }
  const all = [...(sleeper === null ? [] : [sleeper]), ...Object.values(sources)]
  return { sleeper, sources, consensus: all.length ? all.reduce((sum, value) => sum + value, 0) / all.length : 0 }
}

// How many games the preseason projection counts for once the season is under way. FP/G is
// `(projection × priorGames + season FP/G × gp) / (priorGames + gp)`, so this season's own
// numbers are half of it after 8 games, two thirds after 16 and over 80% after 40. Fantasy
// points per game settle fast in the NBA (minutes and role show up within a couple of weeks),
// so the projection only steadies the first few games.
export const priorGames = 8

// FP/G as the lineup, league and lock alerts value a player: the preseason Cons FP/G blended with
// this season's actual FP/G by games played. A player nobody projected is valued on his season
// alone. Mid-season, Sleeper's totals set every `bonus_*` key to 1 for most players (304 had a
// "40-point game" in week 4 of 2026), so those keys are dropped. That matches the game log, which
// has no `bonus_*` keys either; `dd` and `td` are real counts and stay.
export function blendedPerGame(projected: number, seasonLine: StatLine | undefined, scoring: Record<string, number>) {
  const gp = seasonLine?.gp ?? 0
  const line = Object.fromEntries(Object.entries(seasonLine ?? {}).filter(([key]) => !key.startsWith('bonus_')))
  const season = gp > 0 ? scoreLine(line, scoring) / gp : null
  if (season === null) return { perGame: projected, season, gp, weight: 0 }
  const weight = projected > 0 ? gp / (gp + priorGames) : 1
  return { perGame: projected + (season - projected) * weight, season, gp, weight }
}

// The hero's scoring block: what each counting stat is worth, then the per-game bonuses. Read
// from the league's live settings, so a commissioner change shows up here.
const statLabels: Record<string, string> = {
  pts: 'Point',
  reb: 'Rebound',
  ast: 'Assist',
  stl: 'Steal',
  blk: 'Block',
  tpm: '3-pointer',
  to: 'Turnover',
}

const bonusLabels: Record<string, string> = {
  dd: 'Double-double',
  td: 'Triple-double',
  bonus_pt_40p: '40-point game',
  bonus_pt_50p: '50-point game',
  bonus_ast_15p: '15-assist game',
  bonus_reb_20p: '20-rebound game',
}

export type ScoringItem = { key: string; label: string; value: number }

export function scoringTable(scoring: Record<string, number>) {
  const pick = (labels: Record<string, string>): ScoringItem[] =>
    Object.entries(labels)
      .filter(([key]) => scoring[key])
      .map(([key, label]) => ({ key, label, value: scoring[key] }))
  return { stats: pick(statLabels), bonuses: pick(bonusLabels) }
}
