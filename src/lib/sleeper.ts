// Every Sleeper read the board makes. The API is public, unauthenticated, and sends
// `access-control-allow-origin: *`, so the browser reads it directly with no backend.

const base = 'https://api.sleeper.app/v1'

export const leagueId = '1388653441982664704'
// DTHOR48, the ThorbergBC owner. `?user=` overrides it, which is how a finished draft
// from another league is replayed for testing.
export const defaultUserId = '1388653871391318016'

export type StatLine = Record<string, number>

export type SleeperPlayer = {
  player_id: string
  full_name?: string
  first_name?: string
  last_name?: string
  team?: string | null
  position?: string
  fantasy_positions?: string[] | null
  injury_status?: string | null
  years_exp?: number | null
  active?: boolean
}

export type League = {
  league_id: string
  name: string
  season: string
  status: string
  draft_id: string
  roster_positions: string[]
  scoring_settings: Record<string, number>
  settings: { num_teams: number }
}

export type Draft = {
  draft_id: string
  league_id: string
  season: string
  type: string
  status: 'pre_draft' | 'drafting' | 'paused' | 'complete' | string
  start_time: number | null
  draft_order: Record<string, number> | null
  slot_to_roster_id: Record<string, number> | null
  settings: { rounds: number; teams: number; reversal_round?: number; pick_timer?: number }
}

export type Pick = {
  pick_no: number
  round: number
  draft_slot: number
  roster_id: number
  picked_by: string
  player_id: string
  is_keeper: boolean | null
  metadata?: { first_name?: string; last_name?: string; position?: string; team?: string } | null
}

export type TradedPick = {
  season: string
  round: number
  roster_id: number
  owner_id: number
}

export type LeagueUser = {
  user_id: string
  display_name: string
  metadata?: { team_name?: string } | null
}

export type Roster = {
  roster_id: number
  owner_id: string | null
}

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(`${base}${path}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Sleeper ${path} answered ${response.status}`)
  return response.json() as Promise<T>
}

export const getLeague = (id: string) => readJson<League>(`/league/${id}`)
export const getLeagueUsers = (id: string) => readJson<LeagueUser[]>(`/league/${id}/users`)
export const getRosters = (id: string) => readJson<Roster[]>(`/league/${id}/rosters`)
export const getDraft = (id: string) => readJson<Draft>(`/draft/${id}`)
export const getPicks = (id: string) => readJson<Pick[]>(`/draft/${id}/picks`)
export const getTradedPicks = (id: string) => readJson<TradedPick[]>(`/draft/${id}/traded_picks`)
export const getPlayers = () => readJson<Record<string, SleeperPlayer>>('/players/nba')
// Season projections are a per-game line plus `adp_std` and `adp_dynasty`.
export const getProjections = (season: string) => readJson<Record<string, StatLine>>(`/projections/nba/regular/${season}`)
// Season stats are totals, including the `bonus_*` game counts the projections lack.
export const getSeasonStats = (season: string) => readJson<Record<string, StatLine>>(`/stats/nba/regular/${season}`)
