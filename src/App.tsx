import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import './App.css'
import { assignLineup, fitsSlot, rosterForPick } from './lib/draft'
import { expertAverage, expertRanks, rankingSources, rankingsFetchedAt, type ExpertRanks, type Tier } from './lib/rankings'
import { scoreLine, scoringLegend } from './lib/scoring'
import { createSupabaseClient } from './lib/supabase'
import {
  defaultUserId,
  getDraft,
  getLeague,
  getLeagueUsers,
  getPicks,
  getPlayers,
  getProjections,
  getRosters,
  getSeasonStats,
  getTradedPicks,
  headshotUrl,
  leagueId,
  type Draft,
  type League,
  type LeagueUser,
  type Pick,
  type Roster,
  type SleeperPlayer,
  type StatLine,
  type TradedPick,
} from './lib/sleeper'

type BoardPlayer = {
  id: string
  name: string
  team: string
  positions: string[]
  injury: string
  proj: number
  last: number | null
  lastGp: number | null
  adp: number | null
  rank: number
  gap: number | null
  rookie: boolean
  experts: ExpertRanks
  expert: number | null
  tiers: Tier[]
}

type BaseData = {
  league: League
  users: LeagueUser[]
  rosters: Roster[]
  board: BoardPlayer[]
}

type LiveDraft = {
  draft: Draft
  picks: Pick[]
  traded: TradedPick[]
  checkedAt: number
}

export type Account = {
  userId: string
  getToken: () => Promise<string | null>
}

type SortKey = 'rank' | 'proj' | 'expert' | 'tier' | 'last' | 'lastGp' | 'adp' | 'gap'
type PositionFilter = 'ALL' | 'PG' | 'SG' | 'SF' | 'PF' | 'C' | 'G' | 'F'

const positionOrder = ['PG', 'SG', 'SF', 'PF', 'C']
const positionFilters: PositionFilter[] = ['ALL', 'PG', 'SG', 'SF', 'PF', 'C', 'G', 'F']
const tierPositions: Record<PositionFilter, string[]> = {
  ALL: positionOrder,
  PG: ['PG'],
  SG: ['SG'],
  SF: ['SF'],
  PF: ['PF'],
  C: ['C'],
  G: ['PG', 'SG'],
  F: ['SF', 'PF'],
}
const starredKey = 'hoops.starred'
const params = new URLSearchParams(window.location.search)
// `?draft=` and `?user=` replay another draft, e.g. last season's finished one, for testing.
const draftOverride = params.get('draft')
const userId = params.get('user') ?? defaultUserId

const sortLabels: Record<SortKey, string> = {
  rank: 'Rank',
  proj: 'Proj FP/G',
  expert: 'Experts',
  tier: 'Tier',
  last: 'Last FP/G',
  lastGp: 'Last GP',
  adp: 'ADP',
  gap: 'ADP gap',
}

// ESPN tiers each position separately, so a PG/SG has two. Under a position filter the tier
// shown is that position's; otherwise his best one.
function tierFor(player: BoardPlayer, position: PositionFilter) {
  return player.tiers
    .filter((tier) => tierPositions[position].includes(tier.position))
    .sort((a, b) => a.tier - b.tier || a.rank - b.rank)[0]
}

function expertTitle(player: BoardPlayer) {
  const parts = (['espn', 'rotowire', 'rotoballer'] as const).map((source) => `${rankingSources[source].name} ${player.experts[source] ?? '—'}`)
  return parts.join(' · ')
}

function readStarred() {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(starredKey) ?? '[]'))
  } catch {
    return new Set<string>()
  }
}

function writeStarred(stars: Set<string>) {
  try {
    localStorage.setItem(starredKey, JSON.stringify([...stars]))
  } catch {
    // Stars still work for the session without storage.
  }
}

// Signed in, stars live in `starred_players` so they follow the user between laptop and phone.
// Stars made signed out on this browser are uploaded on sign-in rather than lost.
async function syncStarred(account: Account, local: Set<string>) {
  const client = createSupabaseClient(account.getToken)
  if (!client) return null
  const { data, error } = await client.from('starred_players').select('player_id')
  if (error) throw error
  const remote = new Set(data.map((row: { player_id: string }) => row.player_id))
  const missing = [...local].filter((id) => !remote.has(id))
  if (missing.length) {
    const { error: insertError } = await client
      .from('starred_players')
      .upsert(missing.map((player_id) => ({ user_id: account.userId, player_id })))
    if (insertError) throw insertError
  }
  return new Set([...remote, ...local])
}

function Headshot({ id, name }: { id: string; name: string }) {
  const [failed, setFailed] = useState(false)
  const initials = name.split(' ').map((part) => part[0]).slice(0, 2).join('')
  return (
    <span className="headshot">
      {failed ? initials : <img src={headshotUrl(id)} alt="" loading="lazy" onError={() => setFailed(true)} />}
    </span>
  )
}

function buildBoard(
  players: Record<string, SleeperPlayer>,
  projections: Record<string, StatLine>,
  stats: Record<string, StatLine>,
  scoring: Record<string, number>,
  draftable: number,
) {
  const rows: BoardPlayer[] = []
  for (const [id, line] of Object.entries(projections)) {
    const player = players[id]
    if (!player || !(line.pts > 0)) continue
    const lastLine = stats[id]
    const lastGp = lastLine?.gp ? lastLine.gp : null
    const adp = line.adp_std && line.adp_std < 999 ? line.adp_std : null
    const positions = (player.fantasy_positions?.length ? player.fantasy_positions : [player.position ?? ''])
      .filter(Boolean)
      .sort((a, b) => positionOrder.indexOf(a) - positionOrder.indexOf(b))
    rows.push({
      id,
      name: player.full_name ?? `${player.first_name ?? ''} ${player.last_name ?? ''}`.trim(),
      team: player.team ?? 'FA',
      positions,
      injury: player.injury_status ?? '',
      proj: scoreLine(line, scoring) / (line.gp || 1),
      last: lastGp ? scoreLine(lastLine, scoring) / lastGp : null,
      lastGp,
      adp,
      rank: 0,
      gap: null,
      rookie: player.years_exp === 0,
      experts: expertRanks(id),
      expert: expertAverage(expertRanks(id)),
      tiers: expertRanks(id).tiers ?? [],
    })
  }
  rows.sort((a, b) => b.proj - a.proj)
  rows.forEach((row, index) => {
    row.rank = index + 1
    // Only players our points would draft get a gap; beyond that the gap only measures how
    // far apart two undraftable numbers are.
    row.gap = row.adp === null || row.rank > draftable ? null : Math.round(row.adp - row.rank)
  })
  return rows
}

// A drafted player Sleeper has no projection for, built from the pick's own metadata so he
// still fills a roster spot.
function unprojectedPlayer(pick: Pick): BoardPlayer {
  const meta = pick.metadata ?? {}
  return {
    id: pick.player_id,
    name: `${meta.first_name ?? ''} ${meta.last_name ?? ''}`.trim() || pick.player_id,
    team: meta.team || 'FA',
    positions: meta.position ? [meta.position] : [],
    injury: '',
    proj: 0,
    last: null,
    lastGp: null,
    adp: null,
    rank: 0,
    gap: null,
    rookie: false,
    experts: {},
    expert: null,
    tiers: [],
  }
}

async function loadAll(): Promise<{ base: BaseData; live: LiveDraft }> {
  const league = await getLeague(leagueId)
  const draftId = draftOverride ?? league.draft_id
  const lastSeason = String(Number(league.season) - 1)
  const [draft, players, projections, stats] = await Promise.all([
    getDraft(draftId),
    getPlayers(),
    getProjections(league.season),
    getSeasonStats(lastSeason),
  ])
  // Owners come from the draft's own league, which differs from Beer League only in a replay.
  const [users, rosters, picks, traded] = await Promise.all([
    getLeagueUsers(draft.league_id),
    getRosters(draft.league_id),
    getPicks(draftId),
    getTradedPicks(draftId),
  ])
  return {
    base: { league, users, rosters, board: buildBoard(players, projections, stats, league.scoring_settings, league.settings.num_teams * league.roster_positions.length) },
    live: { draft, picks, traded, checkedAt: Date.now() },
  }
}

const formatPoints = (value: number | null) => (value === null ? '—' : value.toFixed(1))

function teamName(user: LeagueUser | undefined, rosterId: number) {
  return user?.metadata?.team_name || user?.display_name || `Team ${rosterId}`
}

function countdown(ms: number) {
  if (ms <= 0) return 'any moment'
  const minutes = Math.floor(ms / 60000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${minutes % 60}m`
  return `${minutes}m`
}

export default function App({ account, accountControl }: { account: Account | null; accountControl: ReactNode }) {
  const [base, setBase] = useState<BaseData | null>(null)
  const [live, setLive] = useState<LiveDraft | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [position, setPosition] = useState<PositionFilter>('ALL')
  const [hideDrafted, setHideDrafted] = useState(true)
  const [starredOnly, setStarredOnly] = useState(false)
  const [needsOnly, setNeedsOnly] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'rank', desc: false })
  const [tab, setTab] = useState<'board' | 'teams'>('board')
  const [starred, setStarred] = useState(readStarred)
  const [now, setNow] = useState(() => Date.now())
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    loadAll()
      .then(({ base, live }) => {
        if (cancelled) return
        setBase(base)
        setLive(live)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught))
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  // Polls fast while picks are being made, slowly otherwise, and stops once the draft is done.
  const draftStatus = live?.draft.status
  const draftId = live?.draft.draft_id
  useEffect(() => {
    if (!draftId || draftStatus === 'complete') return
    const delay = draftStatus === 'drafting' ? 3000 : 30000
    const timer = window.setInterval(async () => {
      try {
        const [draft, picks, traded] = await Promise.all([getDraft(draftId), getPicks(draftId), getTradedPicks(draftId)])
        setLive({ draft, picks, traded, checkedAt: Date.now() })
      } catch {
        // A missed poll is retried on the next tick.
      }
    }, delay)
    return () => window.clearInterval(timer)
  }, [draftId, draftStatus])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!account) return
    let cancelled = false
    syncStarred(account, readStarred())
      .then((merged) => {
        if (!merged || cancelled) return
        writeStarred(merged)
        setStarred(merged)
      })
      .catch((caught: unknown) => console.error('Could not sync stars', caught))
    return () => {
      cancelled = true
    }
  }, [account])

  const toggleStar = (id: string) => {
    const adding = !starred.has(id)
    const next = new Set(starred)
    if (adding) next.add(id)
    else next.delete(id)
    setStarred(next)
    writeStarred(next)
    const client = account ? createSupabaseClient(account.getToken) : null
    if (!client || !account) return
    const write = adding
      ? client.from('starred_players').upsert({ user_id: account.userId, player_id: id })
      : client.from('starred_players').delete().eq('user_id', account.userId).eq('player_id', id)
    write.then(({ error: writeError }) => {
      if (writeError) console.error('Could not save star', writeError)
    })
  }

  const playerById = useMemo(() => new Map(base?.board.map((player) => [player.id, player]) ?? []), [base])

  const ownerByRoster = useMemo(() => {
    const users = new Map(base?.users.map((user) => [user.user_id, user]) ?? [])
    const names = new Map<number, string>()
    base?.rosters.forEach((roster) => names.set(roster.roster_id, teamName(users.get(roster.owner_id ?? ''), roster.roster_id)))
    return names
  }, [base])

  const draftState = useMemo(() => {
    if (!base || !live) return null
    const { draft, picks, traded } = live
    const sorted = [...picks].sort((a, b) => a.pick_no - b.pick_no)
    const drafted = new Map(sorted.map((pick) => [pick.player_id, pick]))
    const totalPicks = draft.settings.rounds * draft.settings.teams
    const mySlot = draft.draft_order?.[userId]
    const myRosterId = mySlot ? draft.slot_to_roster_id?.[String(mySlot)] : undefined
    const currentPick = sorted.length + 1
    const myUpcoming: number[] = []
    for (let pickNo = currentPick; pickNo <= totalPicks && myUpcoming.length < 3; pickNo++) {
      if (rosterForPick(pickNo, draft, traded) === myRosterId) myUpcoming.push(pickNo)
    }
    const byRoster = new Map<number, BoardPlayer[]>()
    for (const pick of sorted) {
      const player = playerById.get(pick.player_id) ?? unprojectedPlayer(pick)
      byRoster.set(pick.roster_id, [...(byRoster.get(pick.roster_id) ?? []), player])
    }
    const myPlayers = myRosterId ? (byRoster.get(myRosterId) ?? []) : []
    const myLineup = assignLineup(base.league.roster_positions, myPlayers)
    const openSlots = myLineup.starters.filter((entry) => !entry.player && entry.slot !== 'UTIL').map((entry) => entry.slot)
    return {
      sorted,
      drafted,
      totalPicks,
      currentPick,
      onClock: currentPick <= totalPicks ? rosterForPick(currentPick, draft, traded) : undefined,
      myRosterId,
      myUpcoming,
      byRoster,
      myLineup,
      openSlots,
    }
  }, [base, live, playerById])

  const visible = useMemo(() => {
    if (!base || !draftState) return []
    const query = search.trim().toLowerCase()
    const rows = base.board.filter((player) => {
      if (hideDrafted && draftState.drafted.has(player.id)) return false
      if (starredOnly && !starred.has(player.id)) return false
      if (query && !player.name.toLowerCase().includes(query) && !player.team.toLowerCase().includes(query)) return false
      if (position !== 'ALL' && !fitsSlot(position, player.positions)) return false
      if (needsOnly && !draftState.openSlots.some((slot) => fitsSlot(slot, player.positions))) return false
      return true
    })
    const single = position !== 'ALL' && position !== 'G' && position !== 'F'
    const value = (player: BoardPlayer) => {
      if (sort.key === 'tier') {
        const tier = tierFor(player, position)
        // One position follows ESPN's own order; a mix of positions goes by expert rank inside a tier.
        return tier ? tier.tier * 1000 + (single ? tier.rank : (player.expert ?? 999)) : Infinity
      }
      const raw = sort.key === 'rank' ? player.rank : player[sort.key]
      return raw ?? (sort.desc ? -Infinity : Infinity)
    }
    return rows.sort((a, b) => (sort.desc ? value(b) - value(a) : value(a) - value(b)))
  }, [base, draftState, search, position, hideDrafted, starredOnly, needsOnly, starred, sort])

  if (error) {
    return (
      <main className="status-screen">
        <h1>Couldn't reach Sleeper</h1>
        <p>{error}</p>
        <button className="button" onClick={() => { setError(''); setAttempt((count) => count + 1) }}>Try again</button>
      </main>
    )
  }

  if (!base || !live || !draftState) {
    return (
      <main className="status-screen">
        <h1>Loading the player pool</h1>
        <p>Reading every NBA player, the 2026 projections, and last season's stats from Sleeper.</p>
      </main>
    )
  }

  const { draft } = live
  const myNext = draftState.myUpcoming[0]
  const myFollowing = draftState.myUpcoming[1]
  const onMyClock = draft.status === 'drafting' && draftState.onClock === draftState.myRosterId
  const lastPicked = (draft as Draft & { last_picked?: number }).last_picked
  const timer = draft.status === 'drafting' && lastPicked && draft.settings.pick_timer
    ? Math.max(0, Math.round(draft.settings.pick_timer - (now - lastPicked) / 1000))
    : null
  const bestAvailable = base.board.filter((player) => !draftState.drafted.has(player.id)).slice(0, 8)

  const sortBy = (key: SortKey) =>
    setSort((current) => (current.key === key ? { key, desc: !current.desc } : { key, desc: key === 'proj' || key === 'last' || key === 'lastGp' || key === 'gap' }))

  const header = (key: SortKey, className = '') => (
    <th className={`sortable ${className} ${sort.key === key ? 'sorted' : ''}`} onClick={() => sortBy(key)}>
      {sortLabels[key]}
      {sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
    </th>
  )

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">{base.league.name} · {base.league.season} · {draft.settings.teams} teams · {draft.type}</p>
          <h1>ECTOcooler Hoops</h1>
          <p className="legend">{scoringLegend(base.league.scoring_settings).join(' · ')}</p>
        </div>
        <div className={`clock ${onMyClock ? 'mine' : ''}`}>
          {draft.status === 'pre_draft' && (
            <>
              <span className="clock-label">Draft starts</span>
              <strong>{draft.start_time ? new Date(draft.start_time).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'Not scheduled'}</strong>
              {draft.start_time && <span>in {countdown(draft.start_time - now)}</span>}
            </>
          )}
          {(draft.status === 'drafting' || draft.status === 'paused') && (
            <>
              <span className="clock-label">{draft.status === 'paused' ? 'Paused at' : 'On the clock'} · pick {draftState.currentPick}</span>
              <strong>{onMyClock ? 'You are up' : ownerByRoster.get(draftState.onClock ?? -1) ?? '—'}</strong>
              {timer !== null && <span>{timer}s left</span>}
            </>
          )}
          {draft.status === 'complete' && (
            <>
              <span className="clock-label">Draft</span>
              <strong>Complete</strong>
            </>
          )}
          {myNext && draft.status !== 'complete' && (
            <span className="clock-mine">
              Your picks: {draftState.myUpcoming.join(', ')}
              {draft.status === 'drafting' && !onMyClock && ` · ${myNext - draftState.currentPick} away`}
            </span>
          )}
        </div>
      </header>

      <nav className="tabs">
        <button className={tab === 'board' ? 'active' : ''} onClick={() => setTab('board')}>Board</button>
        <button className={tab === 'teams' ? 'active' : ''} onClick={() => setTab('teams')}>Teams</button>
        <span className="sync">
          {draftState.sorted.length}/{draftState.totalPicks} picks · checked {new Date(live.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
        </span>
        {accountControl && <span className="account">{accountControl}</span>}
      </nav>

      {tab === 'board' ? (
        <div className="layout">
          <section className="board">
            <div className="filters">
              <input className="search" placeholder="Search player or team" value={search} onChange={(event) => setSearch(event.target.value)} />
              <div className="chips">
                {positionFilters.map((filter) => (
                  <button key={filter} className={position === filter ? 'chip active' : 'chip'} onClick={() => setPosition(filter)}>{filter}</button>
                ))}
              </div>
              <div className="toggles">
                <label><input type="checkbox" checked={hideDrafted} onChange={(event) => setHideDrafted(event.target.checked)} /> Hide drafted</label>
                <label><input type="checkbox" checked={starredOnly} onChange={(event) => setStarredOnly(event.target.checked)} /> Starred</label>
                <label title="Players who fit a starting slot you have not filled (UTIL aside)">
                  <input type="checkbox" checked={needsOnly} onChange={(event) => setNeedsOnly(event.target.checked)} /> My needs
                </label>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="star-cell" />
                    {header('rank', 'num')}
                    <th>Player</th>
                    {header('proj', 'num')}
                    {header('expert', 'num wide')}
                    {header('tier', 'wide')}
                    {header('last', 'num wide')}
                    {header('lastGp', 'num wide')}
                    {header('adp', 'num')}
                    {header('gap', 'num wide')}
                    {myFollowing && <th className="num wide" title={`Whether standard ADP says he is still there at your pick ${myFollowing}`}>At #{myFollowing}</th>}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((player, index) => {
                    const pick = draftState.drafted.get(player.id)
                    const mine = pick && pick.roster_id === draftState.myRosterId
                    const tier = tierFor(player, position)
                    const tierStarts = sort.key === 'tier' && !sort.desc && tier && (index === 0 || tier.tier !== tierFor(visible[index - 1], position)?.tier)
                    return (
                      <Fragment key={player.id}>
                        {tierStarts && <tr className="tier-row"><td colSpan={myFollowing ? 11 : 10}>Tier {tier.tier}</td></tr>}
                        <tr className={pick ? (mine ? 'drafted mine' : 'drafted') : ''}>
                          <td className="star-cell">
                            <button className={starred.has(player.id) ? 'star on' : 'star'} onClick={() => toggleStar(player.id)} aria-label="Star player">★</button>
                          </td>
                          <td className="num muted">
                            <div className="rank-cell">
                              {player.rank}
                              <Headshot id={player.id} name={player.name} />
                            </div>
                          </td>
                          <td>
                            <div className="player">
                              <span className="name">{player.name}</span>
                              <span className="meta">
                                {player.positions.join('/')} · {player.team}
                                {player.rookie && <em className="tag rookie">R</em>}
                                {player.injury && <em className="tag injury">{player.injury}</em>}
                                {tier && <em className="tag tier">{tier.position} T{tier.tier}</em>}
                                {pick && <em className="tag taken">#{pick.pick_no} {mine ? 'You' : ownerByRoster.get(pick.roster_id)}</em>}
                              </span>
                            </div>
                          </td>
                          <td className="num strong">{formatPoints(player.proj)}</td>
                          <td className="num wide" title={expertTitle(player)}>{player.expert === null ? '—' : Math.round(player.expert)}</td>
                          <td className="wide tier-cell">{tier ? `${tier.position} ${tier.tier}` : '—'}</td>
                          <td className="num wide">{formatPoints(player.last)}</td>
                          <td className={`num wide ${player.lastGp !== null && player.lastGp < 50 ? 'warn' : ''}`}>{player.lastGp ?? '—'}</td>
                          <td className="num">{player.adp === null ? '—' : player.adp.toFixed(1)}</td>
                          <td className={`num wide ${player.gap === null ? '' : player.gap >= 5 ? 'good' : player.gap <= -5 ? 'bad' : ''}`}>
                            {player.gap === null ? '—' : player.gap > 0 ? `+${player.gap}` : player.gap}
                          </td>
                          {myFollowing && (
                            <td className="num wide">
                              {player.adp === null ? <span className="good">likely</span> : player.adp >= myFollowing ? <span className="good">likely</span> : <span className="muted">gone</span>}
                            </td>
                          )}
                        </tr>
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
              {!visible.length && <p className="empty">No players match.</p>}
            </div>
          </section>

          <aside className="side">
            <section className="panel">
              <h2>My team</h2>
              <ul className="lineup">
                {draftState.myLineup.starters.map((entry, index) => (
                  <li key={`${entry.slot}-${index}`} className={entry.player ? '' : 'open'}>
                    <span className="slot">{entry.slot}</span>
                    <span>{entry.player ? entry.player.name : 'Open'}</span>
                    <span className="num">{entry.player ? formatPoints(entry.player.proj) : ''}</span>
                  </li>
                ))}
                {draftState.myLineup.bench.map((player) => (
                  <li key={player.id}>
                    <span className="slot">BN</span>
                    <span>{player.name}</span>
                    <span className="num">{formatPoints(player.proj)}</span>
                  </li>
                ))}
              </ul>
              {draftState.myRosterId === undefined && <p className="note">This user has no slot in the draft order yet.</p>}
            </section>

            <section className="panel">
              <h2>Best available</h2>
              <ul className="best">
                {bestAvailable.map((player) => {
                  const fills = draftState.openSlots.some((slot) => fitsSlot(slot, player.positions))
                  return (
                    <li key={player.id}>
                      <span className="name">{player.name}</span>
                      <span className="meta">{player.positions.join('/')}{fills && <em className="tag need">need</em>}</span>
                      <span className="num">{formatPoints(player.proj)}</span>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section className="panel">
              <h2>Recent picks</h2>
              {draftState.sorted.length ? (
                <ul className="recent">
                  {draftState.sorted.slice(-10).reverse().map((pick) => {
                    const player = playerById.get(pick.player_id) ?? unprojectedPlayer(pick)
                    return (
                      <li key={pick.pick_no} className={pick.roster_id === draftState.myRosterId ? 'mine' : ''}>
                        <span className="num muted">{pick.pick_no}</span>
                        <span>{player.name}<span className="meta"> · {ownerByRoster.get(pick.roster_id)}</span></span>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="note">No picks yet. The board updates by itself once the draft starts.</p>
              )}
            </section>
          </aside>
        </div>
      ) : (
        <section className="teams">
          {Object.entries(draft.slot_to_roster_id ?? {})
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([slot, rosterId]) => {
              const players = draftState.byRoster.get(rosterId) ?? []
              const lineup = assignLineup(base.league.roster_positions, players)
              const open = lineup.starters.filter((entry) => !entry.player).map((entry) => entry.slot)
              const total = players.reduce((sum, player) => sum + player.proj, 0)
              return (
                <article key={slot} className={`team ${rosterId === draftState.myRosterId ? 'mine' : ''} ${rosterId === draftState.onClock && draft.status === 'drafting' ? 'clock-on' : ''}`}>
                  <header>
                    <span className="slot-no">{slot}</span>
                    <strong>{ownerByRoster.get(rosterId)}</strong>
                    <span className="num">{total.toFixed(0)}</span>
                  </header>
                  <ul>
                    {players.map((player) => (
                      <li key={player.id}>
                        <span>{player.name}</span>
                        <span className="meta">{player.positions.join('/')}</span>
                      </li>
                    ))}
                  </ul>
                  {players.length > 0 && open.length > 0 && <p className="note">Open: {open.join(', ')}</p>}
                </article>
              )
            })}
        </section>
      )}

      <footer className="footer">
        Projections, ADP and stats from Sleeper. Rank is projected points per game in this league's scoring; projections leave out the 40/50 point, 15 assist and 20 rebound bonuses. Last season is {Number(base.league.season) - 1}, with its bonuses. ADP gap is standard ADP minus rank, shown for the top players a full draft would take: positive means the room usually takes him later than his points say.
        {' '}Experts is the average of the{' '}
        {(['espn', 'rotowire', 'rotoballer'] as const).map((source, index) => (
          <Fragment key={source}>
            {index ? (index === 2 ? ' and ' : ', ') : ''}
            <a href={rankingSources[source].url} target="_blank" rel="noreferrer">{rankingSources[source].name}</a>
          </Fragment>
        ))}{' '}
        points-league rankings; tiers are <a href={rankingSources.tiers.url} target="_blank" rel="noreferrer">ESPN's points draft tiers</a> by position. Both as of {new Date(rankingsFetchedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}.
      </footer>
    </div>
  )
}
