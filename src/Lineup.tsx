import { useMemo, useState, type ReactNode } from 'react'
import type { LeagueTeam } from './League'
import {
  bestLineup,
  currentWeek,
  datesBetween,
  dayLetter,
  shortDate,
  usToday,
  valuePlayers,
  weekScore,
  type LineupPlayer,
  type Valued,
  type Week,
} from './lib/lineup'
import { liveState, sideSummary, type LiveGame, type LiveState } from './lib/live'
import { useLiveWeek } from './useLiveWeek'
import { useWeeks } from './useWeeks'

export type { LineupPlayer }

const format = (value: number) => value.toFixed(1)
const real = (id: string | undefined): id is string => !!id && id !== '0'
// The Best lineup toggle and the Week plan's Start/Sit moves are hidden until this season's stats
// can value players with no preseason projection. Until then they count as 0.0 FP/G, and the best
// lineup benches them.
const bestLineupView = false
// How far a score is above or below its lock bar: +15, −7.5. A whole number drops its decimal.
const margin = (value: number) => `${value < 0 ? '−' : '+'}${Number(Math.abs(value).toFixed(1))}`

// One dot per day of the week, orange on game days and faded once the day has passed. A game he
// played carries its score in the tooltip, and a locked game is ringed.
export function GameDays({ days, games, today, played, locked }: { days: string[]; games: string[]; today: string; played?: LiveGame[]; locked?: string | null }) {
  return (
    <div className="days">
      {days.map((date) => {
        const plays = games.includes(date)
        const game = played?.find((entry) => entry.date === date)
        return (
          <span
            key={date}
            className={`day ${plays ? 'plays' : ''} ${date < today ? 'past' : ''} ${date === locked ? 'locked' : ''}`}
            title={`${shortDate(date)}${plays ? ' · game' : ''}${game ? ` · ${format(game.score)}${game.done ? '' : ' so far'}` : ''}${date === locked ? ' · locked' : ''}`}
          >
            {dayLetter(date)}
          </span>
        )
      })}
    </div>
  )
}

// A padlock that takes the text colour.
export function LockIcon({ title }: { title?: string }) {
  return (
    <svg className="lock-icon" viewBox="0 0 12 14" width="10" height="12" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <path d="M3.2 6.5V4.2a2.8 2.8 0 0 1 5.6 0v2.3" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <rect x="1" y="6" width="10" height="8" rx="1.6" fill="currentColor" />
    </svg>
  )
}

// How many of a side's starters have points that can no longer change.
export function LockCount({ settled, starters }: { settled: number; starters: number }) {
  return (
    <small
      className={`lock-count ${settled === starters ? 'all' : ''}`}
      title="Starters whose points are locked in: a game the manager locked, or no games left this week. Sleeper doesn't publish locks, so one made between games shows once the player's next game starts."
    >
      <LockIcon /> {settled}/{starters} locked
    </small>
  )
}

const lockTitle = (lock: NonNullable<LiveState['lock']>) =>
  lock.why === 'locked' ? `Locked: his ${lock.date ? dayLetter(lock.date) : ''} game counts` : lock.date ? 'Locked in: no games left, so his last one counts' : 'Locked in: no games this week'

export function WeekBar({ weeks, week, onChange }: { weeks: Week[]; week: Week; onChange: (week: number) => void }) {
  const today = usToday()
  const live = week.start <= today && today <= week.end
  const current = currentWeek(weeks).week
  return (
    <div className="week-bar">
      <button className="chip" disabled={week.week <= weeks[0].week} onClick={() => onChange(week.week - 1)} aria-label="Previous week">‹</button>
      <div>
        <strong>Week {week.week}</strong>
        <span className="meta"> · {shortDate(week.start)} – {shortDate(week.end)}{live ? ' · this week' : ''}</span>
      </div>
      <button className="chip" disabled={week.week >= weeks[weeks.length - 1].week} onClick={() => onChange(week.week + 1)} aria-label="Next week">›</button>
      {current !== week.week && <button className="chip" onClick={() => onChange(current)}>Current</button>}
    </div>
  )
}

// A rostered player valued for the week. `expected` is what he is worth as a starter from here:
// before the week, his lock value over all its games; once it starts, his live value (lib/live).
type Row = Valued & { starting: boolean; state: LiveState | null; expected: number }

export default function Lineup({
  leagueId,
  season,
  rosterPositions,
  scoring,
  playoffWeekStart,
  rosterId,
  teamName,
  teams,
  players,
  reserve,
  sleeperStarters,
  lookup,
  headshot,
}: {
  leagueId: string
  season: string
  rosterPositions: string[]
  scoring: Record<string, number>
  playoffWeekStart: number
  rosterId: number | undefined
  teamName: string
  teams: LeagueTeam[]
  players: LineupPlayer[]
  reserve: LineupPlayer[]
  sleeperStarters: string[] | null
  // Any player by Sleeper id, for one in a past week's lineup who has since left the roster.
  lookup: (id: string) => LineupPlayer | null
  headshot: (player: LineupPlayer) => ReactNode
}) {
  const { weeks, error } = useWeeks(season)
  const [weekNo, setWeekNo] = useState<number | null>(null)
  const [view, setView] = useState<'sleeper' | 'best'>('sleeper')

  const week = weeks && (weeks.find((entry) => entry.week === weekNo) ?? currentWeek(weeks))
  const slots = useMemo(() => rosterPositions.filter((slot) => slot !== 'BN' && slot !== 'IR'), [rosterPositions])
  const { snapshot, started, live } = useLiveWeek(leagueId, season, week, true)
  const playoffs = !!week && week.week >= playoffWeekStart

  const sides = snapshot?.matchups
  const mine = rosterId === undefined ? undefined : sides?.find((side) => side.roster_id === rosterId)
  // Playoff matchups are placeholders until the bracket is seeded, which happens before the week.
  const opponentSide = mine && mine.matchup_id !== null && (!playoffs || started)
    ? sides?.find((side) => side.matchup_id === mine.matchup_id && side.roster_id !== mine.roster_id)
    : undefined

  const plan = useMemo(() => {
    if (!week) return null
    const weekLive = started ? (snapshot?.live ?? null) : null
    // Once the week starts, its own matchup has the lineup and roster that score it; before, the
    // roster as it is now.
    const starterIds = (started && mine?.starters?.length ? mine.starters : sleeperStarters) ?? []
    const known = new Map([...players, ...reserve].map((player) => [player.id, player]))
    const reserveIds = new Set(reserve.map((player) => player.id))
    const weekIds = started && mine?.players?.length ? [...new Set([...mine.players, ...starterIds.filter(real)])] : [...known.keys()]
    const find = (id: string) => known.get(id) ?? lookup(id)
    const pick = (keep: (id: string) => boolean) => weekIds.filter(keep).map(find).filter((player): player is LineupPlayer => !!player)
    const starting = new Set(starterIds.filter(real))
    const points = mine?.players_points ?? {}
    const toRows = (list: LineupPlayer[]): Row[] =>
      valuePlayers(list, week).map((player) => {
        const isStarter = starting.has(player.id)
        const state = weekLive ? liveState(player, points[player.id] ?? 0, weekLive, scoring, isStarter) : null
        const expected = state ? state.value : player.values[player.games.length]
        // A hair of FP/G breaks ties, so a week where nobody plays still starts the better players.
        return { ...player, starting: isStarter, state, expected, value: expected + player.perGame * 1e-3 }
      })
    const rows = toRows(pick((id) => !reserveIds.has(id) || starting.has(id)))
    const byId = new Map(rows.map((player) => [player.id, player]))

    const sleeper = slots.map((slot, index) => ({ slot, player: byId.get(starterIds[index]) }))
    const hasSleeper = sleeper.some((entry) => entry.player)
    // Starters who are locked in or playing right now stay put; the rest of the lineup is the
    // best assignment of everyone else to the open slots.
    const fixed = sleeper.map((entry) => !!entry.player?.state && (!!entry.player.state.lock || entry.player.state.playing))
    const open = slots.filter((_, index) => !fixed[index])
    const fixedIds = new Set(sleeper.filter((_, index) => fixed[index]).map((entry) => entry.player?.id))
    const solved = bestLineup(open, rows.filter((player) => !fixedIds.has(player.id)))
    let next = 0
    const best = slots.map((slot, index) => ({ slot, player: fixed[index] ? sleeper[index].player : solved.starters[next++].player }))

    const inLineup = (lineup: { player?: Row }[]) => lineup.map((entry) => entry.player).filter((player): player is Row => !!player)
    const total = (list: Row[]) => list.reduce((sum, player) => sum + player.expected, 0)
    const optimal = inLineup(best)
    const current = inLineup(sleeper)
    const optimalIds = new Set(optimal.map((player) => player.id))
    const byExpected = (a: Row, b: Row) => b.value - a.value
    return {
      hasSleeper,
      sleeper: { starters: sleeper, bench: rows.filter((player) => !starting.has(player.id)).sort(byExpected) },
      best: { starters: best, bench: solved.bench },
      reserve: toRows(pick((id) => reserveIds.has(id) && !starting.has(id))),
      optimalTotal: total(optimal),
      currentTotal: current.length ? total(current) : null,
      settled: current.filter((player) => player.state?.lock).length,
      starters: current.length,
      start: optimal.filter((player) => !starting.has(player.id)),
      sit: current.filter((player) => !optimalIds.has(player.id)),
    }
  }, [week, started, snapshot, mine, sleeperStarters, players, reserve, lookup, slots, scoring])

  if (error) return <p className="empty">Couldn't load the NBA schedule: {error}</p>
  if (!weeks || !week || !plan) return <p className="empty">Loading the NBA schedule…</p>

  const today = usToday()
  const days = datesBetween(week.start, week.end)
  const shownView = plan.hasSleeper ? view : 'best'
  const lineup = shownView === 'sleeper' ? plan.sleeper : plan.best
  const columns = started ? 7 : 6
  // Mid-week, what is left matters more than the week's total.
  const gamesNote = (player: Row) => (player.state ? `${player.state.left} left` : `${player.games.length}g`)

  const row = (slot: string, player: Row | undefined, key: string) => {
    if (!player) {
      return (
        <tr key={key} className="open">
          <td className="slot">{slot}</td>
          <td colSpan={columns - 1} className="muted">Empty</td>
        </tr>
      )
    }
    const state = player.state
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
                {state?.playing && <em className="tag playing">Playing</em>}
              </span>
            </div>
          </div>
        </td>
        <td>
          <GameDays days={days} games={player.games} today={today} played={state?.played} locked={state?.lock?.why === 'locked' ? state.lock.date : null} />
        </td>
        <td className="num strong">{player.games.length}</td>
        <td className="num wide">{format(player.perGame)}</td>
        <td
          className="num strong"
          title={state ? 'Expected final points from here, counting his lock and the games he has left' : 'Expected locked score: one game counts, and more games mean more chances at a big one'}
        >
          {format(player.expected)}
        </td>
        {started && (
          <td className={`num pts ${player.starting ? 'strong' : 'muted'} ${state?.lock ? 'locked' : ''}`} title={state?.lock ? lockTitle(state.lock) : player.starting ? 'Sleeper points so far' : 'Bench points do not count'}>
            {state?.played.length || state?.points ? format(state.points) : '—'}
            {state?.lock && <LockIcon />}
          </td>
        )}
      </tr>
    )
  }

  // Lock guide: after game i of n, a score worth locking beats what the remaining games are worth.
  const guide = (plan.hasSleeper ? plan.sleeper : plan.best).starters
    .map((entry) => entry.player)
    .filter((player): player is Row => !!player && player.games.length > 1 && !player.out)

  const myTeam = teams.find((team) => team.rosterId === rosterId)
  const opponent = opponentSide && teams.find((team) => team.rosterId === opponentSide.roster_id)
  const opponentSummary = opponentSide && started && snapshot?.live ? sideSummary(opponentSide, lookup, snapshot.live, scoring) : null
  const record = (team: LeagueTeam | undefined) => (team ? `${team.wins}-${team.losses}${team.ties ? `-${team.ties}` : ''}` : '')
  const scoreboard = [
    {
      key: 'mine',
      name: teamName,
      record: record(myTeam),
      points: mine?.points ?? 0,
      projected: started && plan.currentTotal !== null ? plan.currentTotal : plan.optimalTotal,
      settled: plan.settled,
      starters: plan.starters,
    },
    ...(opponentSide
      ? [{
          key: 'opponent',
          name: opponent?.name ?? `Team ${opponentSide.roster_id}`,
          record: record(opponent),
          points: opponentSide.points,
          projected: opponentSummary?.starters ? opponentSummary.projected : weekScore(slots, opponent?.players ?? [], week),
          settled: opponentSummary?.settled ?? 0,
          starters: opponentSummary?.starters ?? 0,
        }]
      : []),
  ]
  const leader = started && scoreboard.length === 2 && scoreboard[0].points !== scoreboard[1].points
    ? (scoreboard[0].points > scoreboard[1].points ? scoreboard[0] : scoreboard[1]).key
    : null

  return (
    <div className="layout">
      <section>
        <WeekBar weeks={weeks} week={week} onChange={setWeekNo} />

        {mine && (opponentSide || started) && (
          <div className="scoreboard" aria-label={`Week ${week.week} matchup`}>
            {scoreboard.map((side) => (
              <div key={side.key} className={`scoreboard-side ${leader === side.key ? (week.end < today ? 'won' : 'ahead') : ''}`}>
                <span className="scoreboard-team">
                  <strong>{side.name}</strong>
                  <small>{side.record}</small>
                </span>
                <span className="scoreboard-score">{started ? format(side.points) : '—'}</span>
                <span className="scoreboard-meta">
                  <span title={started ? 'Expected final score of these starters, counting their locks' : "Expected locked score of the roster's best lineup"}>proj {format(side.projected)}</span>
                  {live && side.starters > 0 && <LockCount settled={side.settled} starters={side.starters} />}
                </span>
              </div>
            ))}
            {snapshot && (
              <span className="scoreboard-sync">
                {live && <span className="live-dot" />}
                {live ? 'Live · ' : ''}synced {new Date(snapshot.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
          </div>
        )}

        {plan.hasSleeper && (
          <div className="view-bar">
            {bestLineupView && (
              <div className="chips">
                <button className={shownView === 'sleeper' ? 'chip active' : 'chip'} onClick={() => setView('sleeper')}>Sleeper lineup</button>
                <button className={shownView === 'best' ? 'chip active' : 'chip'} onClick={() => setView('best')}>Best lineup</button>
              </div>
            )}
            <span className="meta">
              {shownView === 'sleeper' ? 'As set in Sleeper, re-read every minute while games are on.' : started ? 'Locked starters and anyone playing now stay put.' : 'The lineup worth the most this week.'}
            </span>
          </div>
        )}

        <div className="table-wrap">
          <table className="lineup-table">
            <thead>
              <tr>
                <th>Slot</th>
                <th>Player</th>
                <th>Games</th>
                <th className="num">G</th>
                <th className="num wide">FP/G</th>
                <th className="num" title={started ? 'Expected final points from here' : 'Expected locked score: one game counts, and more games mean more chances at a big one'}>{started ? 'Proj' : 'Value'}</th>
                {started && <th className="num" title="Sleeper points this week: the locked game, or else his latest">Pts</th>}
              </tr>
            </thead>
            <tbody>
              {lineup.starters.map((entry, index) => row(entry.slot, entry.player, `start-${index}`))}
              <tr className="tier-row"><td colSpan={columns}>Bench</td></tr>
              {lineup.bench.map((player) => row('BN', player, player.id))}
              {plan.reserve.length > 0 && <tr className="tier-row"><td colSpan={columns}>IR</td></tr>}
              {plan.reserve.map((player) => row('IR', player, player.id))}
            </tbody>
          </table>
          {!players.length && <p className="empty">No players on this roster yet. The lineup fills in as you draft.</p>}
        </div>
      </section>

      <aside className="side">
        {bestLineupView && (
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
                    <span className="good">Start {player.name} ({gamesNote(player)})</span>
                    {plan.sit[index] && <span className="bad">Sit {plan.sit[index].name} ({gamesNote(plan.sit[index])})</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="panel">
          <h2>Lock guide</h2>
          {guide.length ? (
            <ul className="guide">
              {guide.map((player) => {
                const state = player.state
                const latest = state?.played.at(-1)
                // His latest game, once over, is worth locking if it beat what the games left are worth.
                const bar = state && state.left ? Math.ceil(player.values[state.left]) : null
                const verdict = !state || state.lock || state.playing || !latest?.done || bar === null ? null : latest.score >= bar ? 'lock' : 'wait'
                return (
                  <li key={player.id}>
                    <span className="name">
                      {player.name}
                      {state?.lock?.why === 'locked' && <em className="tag locked"><LockIcon /> Locked {format(state.points)}</em>}
                      {verdict === 'lock' && (
                        <em className="tag lock-now" title={`Advice: his ${format(latest!.score)} beats the ${bar} his games left are worth, so lock it in Sleeper`}>
                          Lock it? {margin(latest!.score - bar!)}
                        </em>
                      )}
                      {verdict === 'wait' && (
                        <em className="tag wait" title={`Advice: his ${format(latest!.score)} is under the ${bar} his games left are worth, so wait`}>
                          Wait {margin(latest!.score - bar!)}
                        </em>
                      )}
                    </span>
                    <span className="meta">
                      {player.games.map((date, index) => {
                        const left = player.games.length - index - 1
                        const game = state?.played.find((entry) => entry.date === date)
                        const target = left ? Math.ceil(player.values[left]) : null
                        return (
                          <span key={date} className={date < today && !game ? 'muted' : ''}>
                            {index ? ' · ' : ''}
                            {dayLetter(date)}{' '}
                            {game ? (
                              <strong className={game.done && target !== null && game.score >= target ? 'good' : ''}>{format(game.score)}</strong>
                            ) : target !== null ? `${target}+` : 'last'}
                            {state?.lock?.why === 'locked' && state.lock.date === date && <LockIcon />}
                          </span>
                        )
                      })}
                    </span>
                  </li>
                )
              })}
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
