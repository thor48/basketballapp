// Lock alerts: posts to Discord when one of the owner's Sleeper starters finishes a game worth
// locking. It is the lineup page's lock guide run on a schedule: after a game with k games still
// to come that week, lock it if it scored at least value(k), what waiting on those k is worth.
// The week's last game never alerts, since Sleeper keeps it anyway, and nor does a game once the
// player's next one has tipped off, since the chance to lock it has passed.
//
//   npm run lock-alerts                       live: post anything new to DISCORD_WEBHOOK_URL
//   npm run lock-alerts -- --dry-run          print what it would post, send and save nothing
//   npm run lock-alerts -- --dry-run --date 2025-11-05 --league 1260852226524454912 --user 337522748299411456
//                                             replay a day of last season's league
//
// GitHub Actions runs it every 20 minutes through game hours (.github/workflows/lock-alerts.yml).
// Each run looks at the whole current week rather than at what changed since the last one, so a
// late or skipped run only delays an alert. `.lock-alerts/sent.json` lists the games already
// alerted, carried between runs in the Actions cache, so each game alerts once.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { currentWeek, lockValues, unavailable, usToday, weeksFromSchedule } from '../src/lib/lineup.ts'
import type { ExpertRanks } from '../src/lib/rankings.ts'
import { projectedPerGame, scoreLine } from '../src/lib/scoring.ts'
import { defaultUserId, getLeague, getPlayers, getProjections, getRosters, getSchedule, getWeekGameLines, leagueId } from '../src/lib/sleeper.ts'

const { values: args } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    date: { type: 'string' },
    league: { type: 'string', default: leagueId },
    user: { type: 'string', default: defaultUserId },
  },
})
const dryRun = args['dry-run']
// Game dates are US days, so "today" is New York's. `--date` replays an earlier day.
const today = args.date ?? usToday()

const stateFile = new URL('../.lock-alerts/sent.json', import.meta.url)
const keep = 500

function readSent() {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8')) as string[]
  } catch {
    return []
  }
}

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
const format = (value: number) => value.toFixed(1)

const league = await getLeague(args.league)
const season = league.season
const [rosters, schedule] = await Promise.all([getRosters(args.league), getSchedule(season)])
const roster = rosters.find((entry) => entry.owner_id === args.user)
const starters = (roster?.starters ?? []).filter((id) => id && id !== '0')
// A postponed or canceled game is no chance to score, so it does not count as a game to come.
const games = schedule.filter((game) => game.status !== 'postponed' && game.status !== 'canceled')
const week = currentWeek(weeksFromSchedule(games), today)
const weekGames = games.filter((game) => game.week === week.week).sort((a, b) => a.date.localeCompare(b.date))
const played = (game: (typeof games)[number]) => game.status === 'complete' && game.date <= today

console.log(`${league.name} week ${week.week} (${week.start} to ${week.end}), today ${today}, ${starters.length} starters`)
if (!starters.length || !weekGames.some(played)) {
  console.log('Nothing to check: no starters set, or no game finished yet this week.')
  process.exit(0)
}

const [players, projections, lines] = await Promise.all([getPlayers(), getProjections(season), getWeekGameLines(season, week.week)])
const experts = (JSON.parse(readFileSync(new URL('../src/data/rankings.json', import.meta.url), 'utf8')) as { players: Record<string, ExpertRanks> }).players
const sent = new Set(readSent())
const alerts: { key: string; text: string }[] = []

for (const id of starters) {
  const player = players[id]
  if (!player?.team) continue
  const name = player.full_name ?? `${player.first_name ?? ''} ${player.last_name ?? ''}`.trim()
  const teamGames = weekGames.filter((game) => game.home.team === player.team || game.away.team === player.team)
  const last = teamGames.filter(played).at(-1)
  if (!last) continue
  const left = teamGames.filter((game) => game.date > last.date)
  if (!left.length) continue
  if (left[0].date <= today && left[0].status !== 'pre_game') continue
  const line = lines.find((entry) => entry.player_id === id && entry.game_id === last.game_id)
  if (!line || !Object.keys(line.stats).length) continue

  const score = scoreLine(line.stats, league.scoring_settings)
  const projection = projections[id]
  // Same number the lineup page values him by: Cons FP/G, or 0 for a player it does not rank.
  const perGame = (projection?.pts ?? 0) > 0 ? projectedPerGame(projection, experts[id]?.projections, league.scoring_settings).consensus : 0
  const out = unavailable.has(player.injury_status ?? '')
  const bar = Math.ceil(lockValues(out ? 0 : perGame, left.length)[left.length])
  const verdict = score > 0 && score >= bar ? 'LOCK' : 'wait'
  console.log(`  ${verdict.padEnd(4)} ${name}: ${format(score)} on ${last.date}, bar ${bar} with ${left.length} left`)
  if (verdict !== 'LOCK') continue

  const key = `${id}:${last.game_id}`
  if (sent.has(key)) continue
  const why = out
    ? `He is listed ${player.injury_status}, so waiting is worth nothing.`
    : `That beats the ${bar} his ${left.length > 1 ? `${left.length} games left are` : 'last game is'} worth (${left.map((game) => weekday(game.date)).join(', ')}).`
  alerts.push({ key, text: `🔒 **Lock ${name}** (${player.team}): **${format(score)}** vs ${line.opponent} ${weekday(last.date)}. ${why}` })
}

if (!alerts.length) {
  console.log('No new lock alerts.')
  process.exit(0)
}

const content = alerts.map((alert) => alert.text).join('\n')
console.log(`\n${content}\n`)
if (dryRun) process.exit(0)

const webhook = process.env.DISCORD_WEBHOOK_URL
if (!webhook) throw new Error('DISCORD_WEBHOOK_URL is not set, so these alerts were not sent.')
const response = await fetch(webhook, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'ECTOcooler Hoops', content, allowed_mentions: { parse: [] } }),
})
if (!response.ok) throw new Error(`Discord answered ${response.status}: ${await response.text()}`)

for (const alert of alerts) sent.add(alert.key)
mkdirSync(new URL('.', stateFile), { recursive: true })
writeFileSync(stateFile, JSON.stringify([...sent].slice(-keep)))
console.log(`Posted ${alerts.length} alert${alerts.length > 1 ? 's' : ''} to Discord.`)
