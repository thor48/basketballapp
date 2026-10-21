import { Fragment, useEffect, useState } from 'react'
import { shortDate, type LineupPlayer } from './lib/lineup'
import { scoreLine } from './lib/scoring'
import { getPlayerGameLog, getPlayerNews, type GameLine, type PlayerNews, type ScheduleGame } from './lib/sleeper'

const format = (value: number) => value.toFixed(1)
const weekday = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'short' })
// Box score columns, in Sleeper's stat keys. Minutes come as seconds played (`sp`).
const boxScore = [
  ['pts', 'PTS'],
  ['reb', 'REB'],
  ['ast', 'AST'],
  ['stl', 'STL'],
  ['blk', 'BLK'],
  ['tpm', '3PM'],
  ['to', 'TO'],
] as const
const upcomingShown = 5
const logShown = 10

// Reads are kept for the page's life, so a panel opened again shows at once and then refreshes.
const cache = new Map<string, unknown>()

function useRead<T>(key: string, read: () => Promise<T>) {
  const [data, setData] = useState<T | null>(() => (cache.get(key) as T | undefined) ?? null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    read()
      .then((fresh) => {
        cache.set(key, fresh)
        if (!cancelled) setData(fresh)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
    // `read` is rebuilt each render; the key names what it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return { data, failed }
}

function ago(published: number) {
  const minutes = Math.round((Date.now() - published) / 60000)
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(published).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// The panel a lineup row opens: his projection against what he has done, his next games, his
// latest news, and this season's game log scored in league points.
export default function PlayerDetail({
  player,
  season,
  scoring,
  schedule,
  today,
}: {
  player: LineupPlayer
  season: string
  scoring: Record<string, number>
  schedule: ScheduleGame[] | null
  today: string
}) {
  const news = useRead<PlayerNews[]>(`news:${player.id}`, () => getPlayerNews(player.id))
  const log = useRead<Record<string, GameLine[] | null>>(`log:${season}:${player.id}`, () => getPlayerGameLog(season, player.id))

  const played = Object.values(log.data ?? {})
    .flatMap((lines) => lines ?? [])
    .filter((line) => Object.keys(line.stats ?? {}).length)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((line) => ({ ...line, score: scoreLine(line.stats, scoring) }))
  const seasonPerGame = played.length ? played.reduce((sum, line) => sum + line.score, 0) / played.length : null
  const upcoming = (schedule ?? [])
    .filter((game) => (game.home.team === player.team || game.away.team === player.team) && game.date >= today)
    .filter((game) => game.status !== 'complete' && game.status !== 'postponed' && game.status !== 'canceled')
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, upcomingShown)

  return (
    <div className="player-detail">
      <div className="detail-summary">
        <span title="Cons FP/G: projected points per game in league scoring">
          <strong>{format(player.perGame)}</strong>
          <small>Projected FP/G</small>
        </span>
        <span>
          <strong>{seasonPerGame === null ? '—' : format(seasonPerGame)}</strong>
          <small>{season} FP/G{played.length ? ` · ${played.length} GP` : ''}</small>
        </span>
        <span>
          <strong>{player.lastPerGame ? format(player.lastPerGame) : '—'}</strong>
          <small>{Number(season) - 1} FP/G{player.lastGp ? ` · ${player.lastGp} GP` : ''}</small>
        </span>
      </div>

      <section className="detail-news">
        <h3>News</h3>
        {news.data === null ? (
          <p className="muted">{news.failed ? "Couldn't load his news." : 'Loading news…'}</p>
        ) : !news.data.length ? (
          <p className="muted">No recent news.</p>
        ) : (
          <ul>
            {news.data.map((item) => (
              <li key={item.source_key}>
                <span className="news-head">
                  <strong>{item.metadata.title?.replace(`${player.name} - `, '') ?? 'Update'}</strong>
                  <small>{ago(item.published)}</small>
                </span>
                {item.metadata.description && <p>{item.metadata.description}</p>}
                {item.metadata.analysis && <p className="muted news-analysis" title={item.metadata.analysis}>{item.metadata.analysis}</p>}
              </li>
            ))}
          </ul>
        )}
        <p className="detail-source">News from RotoWire via Sleeper.</p>
      </section>

      <section className="detail-next">
        <h3>Next games</h3>
        {upcoming.length ? (
          <ul>
            {upcoming.map((game, index) => {
              const home = game.home.team === player.team
              const opponent = home ? game.away : game.home
              return (
                <Fragment key={game.game_id}>
                  {game.week !== upcoming[index - 1]?.week && <li className="detail-week">Week {game.week}</li>}
                  <li>
                    <span className="muted">{weekday(game.date)} {shortDate(game.date)}</span>
                    <strong>{home ? 'vs' : '@'} {opponent.team}</strong>
                    <span className="muted" title="Opponent's record going into the game">{opponent.record ?? ''}</span>
                  </li>
                </Fragment>
              )
            })}
          </ul>
        ) : (
          <p className="muted">No games left on the schedule.</p>
        )}
      </section>

      <section className="detail-log">
        <h3>{season} game log</h3>
        {log.data === null ? (
          <p className="muted">{log.failed ? "Couldn't load his games." : 'Loading games…'}</p>
        ) : !played.length ? (
          <p className="muted">No games played yet this season.</p>
        ) : (
          <div className="detail-log-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Opp</th>
                  <th className="num">MIN</th>
                  {boxScore.map(([key, label]) => <th key={key} className="num">{label}</th>)}
                  <th className="num">FP</th>
                </tr>
              </thead>
              <tbody>
                {played.slice(0, logShown).map((line) => (
                  <tr key={line.game_id}>
                    <td className="muted">{weekday(line.date)} {shortDate(line.date)}</td>
                    <td>{line.opponent}</td>
                    <td className="num muted">{Math.round((line.stats.sp ?? 0) / 60)}</td>
                    {boxScore.map(([key]) => <td key={key} className="num">{line.stats[key] ?? 0}</td>)}
                    <td className={`num strong ${line.score >= player.perGame ? 'good' : ''}`}>{format(line.score)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
