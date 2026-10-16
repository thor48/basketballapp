import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { GameDays, WeekBar } from './Lineup'
import { fitsSlot } from './lib/draft'
import { currentWeek, datesBetween, usToday, valuePlayers, weekScore, type LineupPlayer } from './lib/lineup'
import { getMatchups, type Matchup } from './lib/sleeper'
import { useWeeks } from './useWeeks'

export type LeagueTeam = {
  rosterId: number
  name: string
  // Players who can start: the roster without its IR slots.
  players: LineupPlayer[]
  wins: number
  losses: number
  ties: number
  pointsFor: number
}

const positions = ['ALL', 'PG', 'SG', 'SF', 'PF', 'C', 'G', 'F']
// The free agent list shows at least this many, and beside the sidebar grows to match its height.
const minFreeAgents = 10
const format = (value: number) => value.toFixed(1)
const record = (team: LeagueTeam) => `${team.wins}-${team.losses}${team.ties ? `-${team.ties}` : ''}`

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export default function League({
  leagueId,
  season,
  rosterPositions,
  playoffWeekStart,
  teams,
  freeAgents,
  myRosterId,
  headshot,
}: {
  leagueId: string
  season: string
  rosterPositions: string[]
  playoffWeekStart: number
  teams: LeagueTeam[]
  freeAgents: LineupPlayer[]
  myRosterId: number | undefined
  headshot: (player: LineupPlayer) => ReactNode
}) {
  const { weeks, error } = useWeeks(season)
  const [weekNo, setWeekNo] = useState<number | null>(null)
  const [position, setPosition] = useState('ALL')
  const [byPerGame, setByPerGame] = useState(false)
  const [matchups, setMatchups] = useState<Record<number, Matchup[]>>({})
  const [shownFreeAgents, setShownFreeAgents] = useState(minFreeAgents)
  const sideRef = useRef<HTMLElement>(null)
  const tableRef = useRef<HTMLDivElement>(null)

  const week = weeks && (weeks.find((entry) => entry.week === weekNo) ?? currentWeek(weeks))
  const today = usToday()
  const started = !!week && week.start <= today
  const live = started && !!week && today <= week.end
  const playoffs = !!week && week.week >= playoffWeekStart
  const weekNumber = week?.week

  // Sleeper's playoff matchups are placeholders until the bracket is seeded, so only regular
  // season weeks are read. Scores move while a week is being played, so that week is re-read.
  useEffect(() => {
    if (weekNumber === undefined || weekNumber >= playoffWeekStart) return
    let cancelled = false
    const load = () =>
      getMatchups(leagueId, weekNumber)
        .then((list) => {
          if (!cancelled) setMatchups((current) => ({ ...current, [weekNumber]: list }))
        })
        .catch(() => {
          // A missed read is retried on the next tick or week change.
        })
    load()
    const timer = live ? window.setInterval(load, 60000) : undefined
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [leagueId, weekNumber, playoffWeekStart, live])

  // With the sidebar beside it, the list gains or drops whole rows until its foot lines up with
  // the sidebar's, so neither column trails off. Stacked on a phone, it stays at the minimum.
  const loaded = !!weeks
  useEffect(() => {
    const side = sideRef.current
    const table = tableRef.current
    if (!loaded || !side || !table) return
    let timer = 0
    const measure = () => {
      window.clearTimeout(timer)
      // Deferred, so resizing the list does not land inside the observer's own callback.
      timer = window.setTimeout(() => {
        const sideBox = side.getBoundingClientRect()
        const tableBox = table.getBoundingClientRect()
        const row = table.querySelector('tbody tr')?.getBoundingClientRect().height
        if (sideBox.left < tableBox.right || !row) return setShownFreeAgents(minFreeAgents)
        const extra = Math.floor((sideBox.bottom - tableBox.bottom) / row)
        if (extra) setShownFreeAgents((count) => Math.max(minFreeAgents, count + extra))
      })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(side)
    observer.observe(table)
    observer.observe(table.parentElement ?? table)
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [loaded])

  const slots = useMemo(() => rosterPositions.filter((slot) => slot !== 'BN' && slot !== 'IR'), [rosterPositions])
  const projected = useMemo(
    () => new Map(week ? teams.map((team) => [team.rosterId, weekScore(slots, team.players, week)]) : []),
    [week, teams, slots],
  )
  // Every NBA team on the schedule, so a team idle this week still gets a row.
  const nbaTeams = useMemo(() => [...new Set((weeks ?? []).flatMap((entry) => [...entry.dates.keys()]))].sort(), [weeks])
  const valuedFreeAgents = useMemo(() => (week ? valuePlayers(freeAgents, week) : []), [week, freeAgents])

  if (error) return <p className="empty">Couldn't load the NBA schedule: {error}</p>
  if (!weeks || !week) return <p className="empty">Loading the NBA schedule…</p>

  const teamById = new Map(teams.map((team) => [team.rosterId, team]))
  const pairs = new Map<number, Matchup[]>()
  for (const side of matchups[week.week] ?? []) {
    if (side.matchup_id === null) continue
    pairs.set(side.matchup_id, [...(pairs.get(side.matchup_id) ?? []), side])
  }
  const games = [...pairs.entries()].sort(([a], [b]) => a - b).map(([, sides]) => sides)
  const medianProjected = projected.size ? median([...projected.values()]) : 0
  const medianPoints = started ? median((matchups[week.week] ?? []).map((side) => side.points)) : 0

  const days = datesBetween(week.start, week.end)
  const shown = valuedFreeAgents
    .filter((player) => position === 'ALL' || fitsSlot(position, player.positions))
    .sort((a, b) => (byPerGame ? b.perGame - a.perGame : b.value - a.value))
    .slice(0, shownFreeAgents)

  const nbaWeek = nbaTeams
    .map((team) => ({ team, games: week.dates.get(team) ?? [] }))
    .sort((a, b) => b.games.length - a.games.length || a.team.localeCompare(b.team))
  const standings = [...teams].sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.pointsFor - a.pointsFor)

  return (
    <div className="layout">
      <section className="league">
        <WeekBar weeks={weeks} week={week} onChange={setWeekNo} />

        {playoffs ? (
          <p className="panel note">Playoff week. Six teams make it, and Sleeper seeds the bracket once week {playoffWeekStart - 1} ends.</p>
        ) : !games.length ? (
          <p className="empty">Loading matchups…</p>
        ) : (
          <>
            <div className="matchups">
              {games.map((sides) => {
                const done = week.end < today
                const leader = started && sides.length === 2 && sides[0].points !== sides[1].points
                  ? (sides[0].points > sides[1].points ? sides[0] : sides[1]).roster_id
                  : null
                return (
                  <article key={sides[0].matchup_id} className={`matchup ${sides.some((side) => side.roster_id === myRosterId) ? 'mine' : ''}`}>
                    {sides.map((side) => {
                      const team = teamById.get(side.roster_id)
                      return (
                        <div key={side.roster_id} className={`matchup-side ${leader === side.roster_id ? (done ? 'won' : 'ahead') : ''}`}>
                          <span className="matchup-team">
                            <strong>{team?.name ?? `Team ${side.roster_id}`}</strong>
                            <small>{team ? record(team) : ''}</small>
                          </span>
                          <span className="matchup-proj" title="Expected locked score of this roster's best lineup for the week">
                            {format(projected.get(side.roster_id) ?? 0)}
                            <small>proj</small>
                          </span>
                          {started && <span className="matchup-score">{format(side.points)}</span>}
                        </div>
                      )
                    })}
                  </article>
                )
              })}
            </div>
            <p className="note median">
              Every team also plays the league median: {started ? `${format(medianPoints)} so far, ` : ''}projected {format(medianProjected)} this week.
            </p>
          </>
        )}

        <div className="fa-head">
          <h2>Top free agents</h2>
          <div className="chips">
            {positions.map((filter) => (
              <button key={filter} className={position === filter ? 'chip active' : 'chip'} onClick={() => setPosition(filter)}>{filter}</button>
            ))}
          </div>
        </div>
        <div className="table-wrap" ref={tableRef}>
          <table className="lineup-table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Player</th>
                <th>Games</th>
                <th className="num">G</th>
                <th className={`num sortable ${byPerGame ? 'sorted' : ''}`} onClick={() => setByPerGame(true)}>FP/G{byPerGame ? ' ↓' : ''}</th>
                <th
                  className={`num sortable ${byPerGame ? '' : 'sorted'}`}
                  onClick={() => setByPerGame(false)}
                  title={`Expected locked score in week ${week.week}: one game counts, and more games mean more chances at a big one`}
                >
                  Wk {week.week}{byPerGame ? '' : ' ↓'}
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((player, index) => (
                <tr key={player.id} className={player.games.length === 0 || player.out ? 'idle' : ''}>
                  <td className="num muted">{index + 1}</td>
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
                    <GameDays days={days} games={player.games} today={today} />
                  </td>
                  <td className="num strong">{player.games.length}</td>
                  <td className="num">{format(player.perGame)}</td>
                  <td className="num strong">{format(player.values[player.games.length])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!shown.length && <p className="empty">No free agents at this position.</p>}
        </div>
      </section>

      <aside className="side league-side" ref={sideRef}>
        <section className="panel">
          <h2>Standings</h2>
          <ol className="standings">
            {standings.map((team, index) => (
              <li key={team.rosterId} className={team.rosterId === myRosterId ? 'mine' : ''}>
                <span className="muted">{index + 1}</span>
                <span className="standings-name">{team.name}</span>
                <span className="num">{record(team)}</span>
                <span className="num muted">{format(team.pointsFor)}</span>
              </li>
            ))}
          </ol>
          <p className="note">Wins include the weekly game against the league median. The last column is points for. The top six make the playoffs from week {playoffWeekStart}.</p>
        </section>

        <section className="panel">
          <h2>NBA week {week.week}</h2>
          <ul className="nba-week">
            {nbaWeek.map(({ team, games }) => (
              <li key={team} className={games.length ? '' : 'idle'}>
                <span className="nba-team">{team}</span>
                <GameDays days={days} games={games} today={today} />
                <span className="num strong">{games.length}</span>
              </li>
            ))}
          </ul>
          <p className="note">Teams with the most games first. Every game is another chance at a big night to lock.</p>
        </section>
      </aside>
    </div>
  )
}
