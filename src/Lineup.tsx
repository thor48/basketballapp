import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { bestLineup, currentWeek, lockValues, usToday, weeksFromSchedule, type Week } from './lib/lineup'
import { getSchedule } from './lib/sleeper'

export type LineupPlayer = {
  id: string
  name: string
  team: string
  positions: string[]
  injury: string
  // Projected fantasy points per game in league scoring.
  perGame: number
}

// Statuses that keep a player out for days, not a game-time call. He is shown but valued at 0.
const unavailable = new Set(['Out', 'IR', 'Sus', 'NA'])

const dayLetter = (date: string) => 'SMTWTFS'[new Date(`${date}T12:00:00`).getDay()]
const shortDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })
const format = (value: number) => value.toFixed(1)

function datesBetween(start: string, end: string) {
  const dates: string[] = []
  for (let day = new Date(`${start}T12:00:00`); ; day.setDate(day.getDate() + 1)) {
    const date = day.toLocaleDateString('en-CA')
    dates.push(date)
    if (date >= end) return dates
  }
}

type Valued = LineupPlayer & { games: string[]; out: boolean; values: number[]; value: number }

function valuePlayers(players: LineupPlayer[], week: Week): Valued[] {
  return players.map((player) => {
    const games = week.dates.get(player.team) ?? []
    const out = unavailable.has(player.injury)
    const values = lockValues(out ? 0 : player.perGame, games.length)
    // A hair of FP/G breaks ties, so a week where nobody plays still starts the better players.
    return { ...player, games, out, values, value: values[games.length] + player.perGame * 1e-3 }
  })
}

export default function Lineup({
  season,
  rosterPositions,
  players,
  reserve,
  sleeperStarters,
  headshot,
}: {
  season: string
  rosterPositions: string[]
  players: LineupPlayer[]
  reserve: LineupPlayer[]
  sleeperStarters: string[] | null
  headshot: (player: LineupPlayer) => ReactNode
}) {
  const [weeks, setWeeks] = useState<Week[] | null>(null)
  const [error, setError] = useState('')
  const [weekNo, setWeekNo] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    getSchedule(season)
      .then((games) => {
        if (cancelled) return
        const built = weeksFromSchedule(games)
        setWeeks(built)
        setWeekNo(currentWeek(built)?.week ?? null)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught))
      })
    return () => {
      cancelled = true
    }
  }, [season])

  const week = weeks?.find((entry) => entry.week === weekNo)
  const slots = useMemo(() => rosterPositions.filter((slot) => slot !== 'BN' && slot !== 'IR'), [rosterPositions])

  const plan = useMemo(() => {
    if (!week) return null
    const valued = valuePlayers(players, week)
    const lineup = bestLineup(slots, valued)
    const byId = new Map(valued.map((player) => [player.id, player]))
    const current = (sleeperStarters ?? []).filter((id) => id && id !== '0')
    const currentPlayers = current.map((id) => byId.get(id)).filter((player): player is Valued => !!player)
    const optimal = lineup.starters.map((entry) => entry.player).filter((player): player is Valued => !!player)
    const optimalIds = new Set(optimal.map((player) => player.id))
    const currentIds = new Set(current)
    const total = (list: Valued[]) => list.reduce((sum, player) => sum + player.values[player.games.length], 0)
    return {
      lineup,
      optimalTotal: total(optimal),
      currentTotal: currentPlayers.length ? total(currentPlayers) : null,
      start: optimal.filter((player) => !currentIds.has(player.id)),
      sit: currentPlayers.filter((player) => !optimalIds.has(player.id)),
    }
  }, [week, players, slots, sleeperStarters])

  if (error) return <p className="empty">Couldn't load the NBA schedule: {error}</p>
  if (!weeks || !week || !plan) return <p className="empty">Loading the NBA schedule…</p>

  const today = usToday()
  const days = datesBetween(week.start, week.end)
  const live = week.start <= today && today <= week.end
  const first = weeks[0].week
  const last = weeks[weeks.length - 1].week

  const row = (slot: string, player: Valued | undefined, key: string) => {
    if (!player) {
      return (
        <tr key={key} className="open">
          <td className="slot">{slot}</td>
          <td colSpan={5} className="muted">Empty</td>
        </tr>
      )
    }
    const value = player.values[player.games.length]
    return (
      <tr key={key} className={player.games.length === 0 || player.out ? 'idle' : ''}>
        <td className="slot">{slot}</td>
        <td>
          <div className="rank-cell lineup-player">
            {headshot(player)}
            <div className="player">
              <span className="name">{player.name}</span>
              <span className="meta">
                {player.positions.join('/')} · {player.team}
                {player.injury && <em className="tag injury">{player.injury}</em>}
              </span>
            </div>
          </div>
        </td>
        <td>
          <div className="days">
            {days.map((date) => {
              const plays = player.games.includes(date)
              return (
                <span key={date} className={`day ${plays ? 'plays' : ''} ${date < today ? 'past' : ''}`} title={`${shortDate(date)}${plays ? ' · game' : ''}`}>
                  {dayLetter(date)}
                </span>
              )
            })}
          </div>
        </td>
        <td className="num strong">{player.games.length}</td>
        <td className="num wide">{format(player.perGame)}</td>
        <td className="num strong" title="Expected locked score: one game counts, and more games mean more chances at a big one">
          {format(value)}
        </td>
      </tr>
    )
  }

  // Lock guide: after game i of n, a score worth locking beats what the remaining games are worth.
  const guide = plan.lineup.starters
    .map((entry) => entry.player)
    .filter((player): player is Valued => !!player && player.games.length > 1 && !player.out)

  return (
    <div className="layout">
      <section>
        <div className="week-bar">
          <button className="chip" disabled={week.week <= first} onClick={() => setWeekNo(week.week - 1)} aria-label="Previous week">‹</button>
          <div>
            <strong>Week {week.week}</strong>
            <span className="meta"> · {shortDate(week.start)} – {shortDate(week.end)}{live ? ' · this week' : ''}</span>
          </div>
          <button className="chip" disabled={week.week >= last} onClick={() => setWeekNo(week.week + 1)} aria-label="Next week">›</button>
          {currentWeek(weeks).week !== week.week && (
            <button className="chip" onClick={() => setWeekNo(currentWeek(weeks).week)}>Current</button>
          )}
        </div>
        <div className="table-wrap">
          <table className="lineup-table">
            <thead>
              <tr>
                <th>Slot</th>
                <th>Player</th>
                <th>Games</th>
                <th className="num">G</th>
                <th className="num wide">FP/G</th>
                <th className="num" title="Expected locked score: one game counts, and more games mean more chances at a big one">Value</th>
              </tr>
            </thead>
            <tbody>
              {plan.lineup.starters.map((entry, index) => row(entry.slot, entry.player, `start-${index}`))}
              <tr className="tier-row"><td colSpan={6}>Bench</td></tr>
              {plan.lineup.bench.map((player) => row('BN', player, player.id))}
              {reserve.length > 0 && <tr className="tier-row"><td colSpan={6}>IR</td></tr>}
              {valuePlayers(reserve, week).map((player) => row('IR', player, player.id))}
            </tbody>
          </table>
          {!players.length && <p className="empty">No players on this roster yet. The lineup fills in as you draft.</p>}
        </div>
      </section>

      <aside className="side">
        <section className="panel">
          <h2>Week {week.week} plan</h2>
          <ul className="best">
            <li><span>Best lineup</span><span /><span className="num strong">{format(plan.optimalTotal)}</span></li>
            <li>
              <span>Set in Sleeper</span>
              <span />
              <span className="num">{plan.currentTotal === null ? '—' : format(plan.currentTotal)}</span>
            </li>
          </ul>
          {plan.currentTotal === null ? (
            <p className="note">No starters are set in Sleeper yet. Start the players above.</p>
          ) : plan.start.length === 0 ? (
            <p className="note good">Your Sleeper lineup already matches.</p>
          ) : (
            <ul className="moves">
              {plan.start.map((player, index) => (
                <li key={player.id}>
                  <span className="good">Start {player.name} ({player.games.length}g)</span>
                  {plan.sit[index] && <span className="bad">Sit {plan.sit[index].name} ({plan.sit[index].games.length}g)</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>Lock guide</h2>
          {guide.length ? (
            <ul className="guide">
              {guide.map((player) => (
                <li key={player.id}>
                  <span className="name">{player.name}</span>
                  <span className="meta">
                    {player.games.map((date, index) => {
                      const left = player.games.length - index - 1
                      return (
                        <span key={date} className={date < today ? 'muted' : ''}>
                          {index ? ' · ' : ''}
                          {dayLetter(date)} {left ? `${Math.ceil(player.values[left])}+` : 'last'}
                        </span>
                      )
                    })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="note">No starter has more than one game this week, so there is nothing to decide: each scores his only game.</p>
          )}
          <p className="note">
            After each game, lock it if he scored at least the number shown for that day; otherwise wait. Unlocked, Sleeper keeps his last game of the week.
          </p>
        </section>
      </aside>
    </div>
  )
}
