// Expert points-league rankings, ESPN's positional tiers and ESPN's and FantasyPros' stat
// projections, from the snapshot that `npm run rankings` (scripts/rankings.mjs) writes. Keyed on
// Sleeper player id.

import snapshot from '../data/rankings.json'
import type { StatLine } from './sleeper'

export type ExpertSource = 'espn' | 'rotowire' | 'rotoballer'

export type Tier = {
  position: string
  tier: number
  // Order within the position's tier list.
  rank: number
}

export type ProjectionSource = 'espnProjection' | 'fantasypros'

// Per-game stat lines under Sleeper's stat keys, plus `gp` for projected games.
export type ExpertRanks = Partial<Record<ExpertSource, number>> & {
  tiers?: Tier[]
  projections?: Partial<Record<ProjectionSource, StatLine>>
}

export const expertSources: ExpertSource[] = ['espn', 'rotowire', 'rotoballer']
export const projectionSources: ProjectionSource[] = ['espnProjection', 'fantasypros']
export const rankingSources = snapshot.sources
export const rankingsFetchedAt = snapshot.fetchedAt

const players = snapshot.players as Record<string, ExpertRanks>

// Players with an ESPN or FantasyPros projection, so the board can value those Sleeper skips.
export const projectedIds = new Set(Object.keys(players).filter((id) => projectionSources.some((source) => players[id].projections?.[source])))

export function expertRanks(playerId: string): ExpertRanks {
  return players[playerId] ?? {}
}

// The mean of whichever sources rank him. A player only ESPN's deeper list reaches still gets
// a number; the others stop at 150.
export function expertAverage(ranks: ExpertRanks) {
  const values = expertSources.map((source) => ranks[source]).filter((value): value is number => value !== undefined)
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}
