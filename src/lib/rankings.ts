// Expert points-league rankings and ESPN's positional tiers, from the snapshot that
// `npm run rankings` (scripts/rankings.mjs) writes. Keyed on Sleeper player id.

import snapshot from '../data/rankings.json'

export type ExpertSource = 'espn' | 'rotowire' | 'rotoballer'

export type Tier = {
  position: string
  tier: number
  // Order within the position's tier list.
  rank: number
}

export type ExpertRanks = Partial<Record<ExpertSource, number>> & { tiers?: Tier[] }

export const expertSources: ExpertSource[] = ['espn', 'rotowire', 'rotoballer']
export const rankingSources = snapshot.sources
export const rankingsFetchedAt = snapshot.fetchedAt

const players = snapshot.players as Record<string, ExpertRanks>

export function expertRanks(playerId: string): ExpertRanks {
  return players[playerId] ?? {}
}

// The mean of whichever sources rank him. A player only ESPN's deeper list reaches still gets
// a number; the others stop at 150.
export function expertAverage(ranks: ExpertRanks) {
  const values = expertSources.map((source) => ranks[source]).filter((value): value is number => value !== undefined)
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}
