// Every Sleeper read the board makes. The API is public, unauthenticated, and sends
// `access-control-allow-origin: *`, so the browser reads it directly with no backend.

const base = 'https://api.sleeper.app/v1'

export const leagueId = '1388653441982664704'
// DTHOR48, the ThorbergBC owner. `?user=` overrides it, which is how a finished draft
// from another league is replayed for testing.
export const defaultUserId = '1388653871391318016'

// Sleeper's CDN answers 403 for players it has no photo of, so callers need a fallback.
export const headshotUrl = (playerId: string) => `https://sleepercdn.com/content/nba/players/thumb/${playerId}.jpg`

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
  settings: { num_teams: number; playoff_week_start?: number }
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
  // Empty until the draft finishes. `starters` lines up with the non-bench `roster_positions`,
  // with '0' for an empty slot.
  players?: string[] | null
  starters?: string[] | null
  reserve?: string[] | null
  settings?: { wins?: number; losses?: number; ties?: number; fpts?: number; fpts_decimal?: number } | null
}

// One roster's side of a week's matchup. The two rosters sharing a `matchup_id` play each other;
// `points` is their score so far, 0 before the week starts.
export type Matchup = {
  roster_id: number
  matchup_id: number | null
  points: number
}

// One NBA game. `week` is the Sleeper fantasy week it scores in, so no date maths is needed to
// group games into matchups; `date` is the US calendar day, YYYY-MM-DD.
export type ScheduleGame = {
  game_id: string
  date: string
  week: number
  status: string
  home: { team: string }
  away: { team: string }
}

// One player's line from one game. `week` is the fantasy week; `date` and `game_id` match the
// schedule's. A player who sat has a row with empty `stats`.
export type GameLine = {
  player_id: string
  game_id: string
  date: string
  team: string
  opponent: string
  stats: StatLine
}

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(`${base}${path}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Sleeper ${path} answered ${response.status}`)
  return response.json() as Promise<T>
}

export const getLeague = (id: string) => readJson<League>(`/league/${id}`)
export const getLeagueUsers = (id: string) => readJson<LeagueUser[]>(`/league/${id}/users`)
export const getRosters = (id: string) => readJson<Roster[]>(`/league/${id}/rosters`)
export const getMatchups = (id: string, week: number) => readJson<Matchup[]>(`/league/${id}/matchups/${week}`)
export const getDraft = (id: string) => readJson<Draft>(`/draft/${id}`)
export const getPicks = (id: string) => readJson<Pick[]>(`/draft/${id}/picks`)
export const getTradedPicks = (id: string) => readJson<TradedPick[]>(`/draft/${id}/traded_picks`)
export const getPlayers = () => readJson<Record<string, SleeperPlayer>>('/players/nba')
// Season projections are a per-game line plus `adp_std` and `adp_dynasty`.
export const getProjections = (season: string) => readJson<Record<string, StatLine>>(`/projections/nba/regular/${season}`)
// Season stats are totals, including the `bonus_*` game counts the projections lack.
export const getSeasonStats = (season: string) => readJson<Record<string, StatLine>>(`/stats/nba/regular/${season}`)
// The full regular-season schedule. It lives outside `/v1` but is just as public and CORS-open.
export async function getSchedule(season: string) {
  const response = await fetch(`https://api.sleeper.app/schedule/nba/regular/${season}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Sleeper schedule answered ${response.status}`)
  return response.json() as Promise<ScheduleGame[]>
}
// Every game line of a fantasy week so far, one row per player per game. Also outside `/v1`.
export async function getWeekGameLines(season: string, week: number) {
  const response = await fetch(`https://api.sleeper.app/stats/nba/${season}/${week}?season_type=regular`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Sleeper week ${week} stats answered ${response.status}`)
  return response.json() as Promise<GameLine[]>
}
