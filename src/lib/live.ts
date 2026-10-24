// The `.ts` extensions let plain Node load this, like lib/lineup.ts.
import { lockValues, unavailable, type LineupPlayer } from './lineup.ts'
import { scoreLine } from './scoring.ts'
import type { GameLine, Matchup, ScheduleGame, StatLine } from './sleeper'

// Sleeper's public API does not say which game a manager locked. Under Lock-In a starter's points
// are always one game's score, though: the locked game, or else the latest game he played in (a
// game he sat out does not replace it, last season's matchups show). So a lock shows once he
// plays a later game and his points stay on the earlier one. Between games, locking the game just
// played and not locking yet look the same, so neither is claimed.

// The week as it is being played: each NBA team's games with their status, and every player's
// line from each game he has appeared in so far.
export type LiveWeek = {
  games: Map<string, ScheduleGame[]>
  lines: Map<string, Map<string, StatLine>>
}

export function liveWeek(schedule: ScheduleGame[], week: number, lines: GameLine[]): LiveWeek {
  const games = new Map<string, ScheduleGame[]>()
  for (const game of schedule) {
    // Nobody scores in a postponed or canceled game, so it is no chance to lock.
    if (game.week !== week || game.status === 'postponed' || game.status === 'canceled') continue
    for (const team of [game.home.team, game.away.team]) games.set(team, [...(games.get(team) ?? []), game])
  }
  games.forEach((list) => list.sort((a, b) => a.date.localeCompare(b.date)))
  const byPlayer = new Map<string, Map<string, StatLine>>()
  for (const line of lines) {
    // A player who sat has a row with empty stats.
    if (!Object.keys(line.stats ?? {}).length) continue
    byPlayer.set(line.player_id, (byPlayer.get(line.player_id) ?? new Map()).set(line.game_id, line.stats))
  }
  return { games, lines: byPlayer }
}

export type LiveGame = { date: string; score: number; done: boolean }

export type LiveState = {
  // His Sleeper points this week: one game's score.
  points: number
  // Games he has appeared in, in order. The last may still be going.
  played: LiveGame[]
  // Games still to tip off.
  left: number
  // One of his team's games is under way.
  playing: boolean
  // Why a starter's points can no longer change: the manager locked a game, or his week is over.
  // `marked` is a lock the manager marked on the page; `disputed` when Sleeper's points are not
  // that game's score, so Sleeper is not counting the lock.
  lock: { date: string | null; why: 'locked' | 'final'; marked?: boolean; disputed?: boolean } | null
  // Expected final points. A starter's are his lock, or the better of locking now and waiting; a
  // bench player moved in now only has the games yet to tip off.
  value: number
}

const sameScore = (a: number, b: number) => Math.abs(a - b) < 0.05

export function liveState(player: LineupPlayer, points: number, live: LiveWeek, scoring: Record<string, number>, starting: boolean): LiveState {
  const lines = live.lines.get(player.id)
  const played: LiveGame[] = []
  let left = 0
  let playing = false
  for (const game of live.games.get(player.team) ?? []) {
    const line = lines?.get(game.game_id)
    // The schedule's status can trail the stats by a read, so a line means the game has begun.
    if (game.status === 'pre_game' && !line) {
      left++
      continue
    }
    const done = game.status === 'complete'
    if (!done) playing = true
    if (line) played.push({ date: game.date, score: scoreLine(line, scoring), done })
  }
  const latest = played.at(-1)
  const locked = latest && !sameScore(points, latest.score) ? played.slice(0, -1).findLast((game) => sameScore(points, game.score)) : undefined
  const lock: LiveState['lock'] = !starting
    ? null
    : locked
      ? { date: locked.date, why: 'locked' }
      : !left && !playing
        ? { date: latest?.date ?? null, why: 'final' }
        : null
  // A game under way is a fresh chance, and the one before it can no longer be locked.
  const chances = lockValues(unavailable.has(player.injury) ? 0 : player.perGame, left + (playing ? 1 : 0))
  const value = !starting ? chances[left] : lock ? points : playing ? chances[left + 1] : Math.max(points, chances[left])
  return { points, played, left, playing, lock, value }
}

// Between games, locking the game just played looks the same as not locking yet, so the manager
// can mark a finished game locked on the page right after locking it in Sleeper. A lock his
// points already show wins over a mark. A mark whose game is not his points is kept but flagged:
// either the lock did not go through, or Sleeper's public score is behind.
export function withMark(state: LiveState, markedDate: string | undefined): LiveState {
  const game = markedDate ? state.played.find((entry) => entry.date === markedDate && entry.done) : undefined
  if (!game || state.lock?.why === 'locked') return state
  return { ...state, lock: { date: game.date, why: 'locked', marked: true, disputed: !sameScore(state.points, game.score) }, value: game.score }
}

// One side of a week's matchup as it stands: each starter's state, how many have points that can
// no longer change, and the expected final score.
export function sideSummary(side: Matchup, find: (id: string) => LineupPlayer | null, live: LiveWeek, scoring: Record<string, number>) {
  const states = new Map<string, LiveState>()
  for (const id of side.starters ?? []) {
    const player = id && id !== '0' ? find(id) : null
    if (player) states.set(id, liveState(player, side.players_points?.[id] ?? 0, live, scoring, true))
  }
  const list = [...states.values()]
  return {
    states,
    starters: list.length,
    settled: list.filter((state) => state.lock).length,
    projected: list.reduce((sum, state) => sum + state.value, 0),
  }
}
