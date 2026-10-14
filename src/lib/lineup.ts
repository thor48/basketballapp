// The `.ts` extension lets the lock alert script (scripts/lock-alerts.ts) load this under plain Node.
import { fitsSlot } from './draft.ts'
import type { ScheduleGame } from './sleeper'

// Beer League plays Sleeper's Lock-In mode: each starter scores ONE game per week, the one the
// manager locks after it is played, or his last game of the week if nothing is locked. Games are
// therefore not added up. Every game is another chance at a big night, and a player with no
// game that week scores nothing.

export type Week = {
  week: number
  start: string
  end: string
  // Each team's game dates in the week, YYYY-MM-DD, in order.
  dates: Map<string, string[]>
}

export function weeksFromSchedule(games: ScheduleGame[]) {
  const weeks = new Map<number, Week>()
  for (const game of games) {
    const week = weeks.get(game.week) ?? { week: game.week, start: game.date, end: game.date, dates: new Map() }
    if (game.date < week.start) week.start = game.date
    if (game.date > week.end) week.end = game.date
    for (const team of [game.home.team, game.away.team]) week.dates.set(team, [...(week.dates.get(team) ?? []), game.date])
    weeks.set(game.week, week)
  }
  for (const week of weeks.values()) week.dates.forEach((dates) => dates.sort())
  return [...weeks.values()].sort((a, b) => a.week - b.week)
}

// Today's US date. Game dates are US days, so a late game in the east is still "today".
export const usToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

// The week being played, or the next one between weeks. After the season, the last week.
export function currentWeek(weeks: Week[], today = usToday()) {
  return weeks.find((week) => week.end >= today) ?? weeks[weeks.length - 1]
}

// Statuses that keep a player out for days, not a game-time call. He is valued at 0.
export const unavailable = new Set(['Out', 'IR', 'Sus', 'NA'])

// How much one game's score swings around the player's average, as a share of it. NBA fantasy
// lines vary by roughly a quarter to a third game to game; one figure for everyone keeps the
// model readable and only changes how much an extra game is worth, not who starts.
export const gameSpread = 0.3

// Standard normal density and cumulative distribution (Abramowitz and Stegun 7.1.26).
const density = (z: number) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI)
function cumulative(z: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2)
  const erf = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-z * z / 2)
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2
}

// Expected locked score with `games` chances, locking optimally. With one game left you take
// whatever it is; with more, you lock a game only if it beats what waiting is worth, so
// value(n + 1) = E[max(game, value(n))]. `value(0)` is 0: no game, no points.
export function lockValues(mean: number, games: number) {
  const values = [0]
  if (mean <= 0) return Array.from({ length: games + 1 }, () => 0)
  const sd = mean * gameSpread
  for (let n = 1; n <= games; n++) {
    if (n === 1) {
      values.push(mean)
      continue
    }
    const wait = values[n - 1]
    const z = (wait - mean) / sd
    values.push(wait * cumulative(z) + mean * (1 - cumulative(z)) + sd * density(z))
  }
  return values
}

// The best starting lineup for a set of players, each worth `value`. Unlike the draft board's
// greedy fill, this maximises the total: a max-weight assignment of players to slots, solved
// with the Hungarian algorithm (slots are rows, players columns, padded with empty "players").
export function bestLineup<T extends { positions: string[]; value: number }>(slots: string[], players: T[]) {
  const n = slots.length
  const m = Math.max(players.length, n)
  const blocked = 1e9
  // Cost is negative value; a slot a player cannot fill is blocked, and padding costs nothing.
  const cost = (row: number, col: number) => {
    const player = players[col]
    if (!player) return 0
    return fitsSlot(slots[row], player.positions) ? -player.value : blocked
  }
  const u = new Array(n + 1).fill(0)
  const v = new Array(m + 1).fill(0)
  const match = new Array(m + 1).fill(0)
  const way = new Array(m + 1).fill(0)
  for (let row = 1; row <= n; row++) {
    match[0] = row
    let col0 = 0
    const minv = new Array(m + 1).fill(Infinity)
    const used = new Array(m + 1).fill(false)
    do {
      used[col0] = true
      const row0 = match[col0]
      let delta = Infinity
      let col1 = 0
      for (let col = 1; col <= m; col++) {
        if (used[col]) continue
        const reduced = cost(row0 - 1, col - 1) - u[row0] - v[col]
        if (reduced < minv[col]) {
          minv[col] = reduced
          way[col] = col0
        }
        if (minv[col] < delta) {
          delta = minv[col]
          col1 = col
        }
      }
      for (let col = 0; col <= m; col++) {
        if (used[col]) {
          u[match[col]] += delta
          v[col] -= delta
        } else minv[col] -= delta
      }
      col0 = col1
    } while (match[col0] !== 0)
    do {
      const col1 = way[col0]
      match[col0] = match[col1]
      col0 = col1
    } while (col0)
  }
  const bySlot = new Array<T | undefined>(n)
  for (let col = 1; col <= m; col++) {
    const row = match[col]
    const player = players[col - 1]
    if (row && player && fitsSlot(slots[row - 1], player.positions)) bySlot[row - 1] = player
  }
  const starting = new Set(bySlot.filter(Boolean))
  return {
    starters: slots.map((slot, index) => ({ slot, player: bySlot[index] })),
    bench: players.filter((player) => !starting.has(player)).sort((a, b) => b.value - a.value),
  }
}
