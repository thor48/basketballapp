// Pulls expert points-league rankings, ESPN's positional tiers, and ESPN's and FantasyPros'
// per-game stat projections into src/data/rankings.json, keyed on Sleeper player ids. Run with
// `npm run rankings` and commit the result; the board reads the snapshot, so a source changing
// its page never breaks the live site.
//
// Projections are stored as raw per-game stats under Sleeper's stat keys, so the board scores
// them with the league's own scoring_settings. Only numbers are kept, never the articles' write-ups.

import { writeFile } from 'node:fs/promises'

const season = 2026
const out = new URL('../src/data/rankings.json', import.meta.url)
const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

const sources = {
  espn: {
    name: 'ESPN',
    label: 'ESPN H2H points draft rank',
    url: 'https://www.espn.com/fantasy/basketball/story/_/id/49960162/fantasy-basketball-points-league-rankings-2026-27-nba-season',
  },
  rotowire: {
    name: 'RotoWire',
    label: 'RotoWire top 150 points league rankings',
    url: 'https://www.rotowire.com/basketball/article/fantasy-basketball-points-league-rankings-2026-27-134657',
  },
  rotoballer: {
    name: 'RotoBaller',
    label: 'RotoBaller top 150 points rankings (Yahoo default scoring)',
    url: 'https://www.rotoballer.com/fantasy-basketball-rankings-for-points-leagues-2026-2027/1958458',
  },
  tiers: {
    name: 'ESPN tiers',
    label: 'ESPN points league draft tiers by position',
    url: 'https://www.espn.com/fantasy/basketball/story/_/id/50125975/fantasy-basketball-points-league-draft-tiers-nba-2026-27',
  },
  espnProjection: {
    name: 'ESPN',
    label: 'ESPN season projections, per game',
    url: 'https://fantasy.espn.com/basketball/players/projections',
  },
  fantasypros: {
    name: 'FantasyPros',
    label: 'FantasyPros consensus projections, per game',
    url: 'https://www.fantasypros.com/nba/projections/avg-overall.php',
  },
}

// ESPN's numeric stat ids, mapped to Sleeper's stat keys. 42 is games played.
const espnStats = { 0: 'pts', 1: 'blk', 2: 'stl', 3: 'ast', 6: 'reb', 11: 'to', 17: 'tpm', 42: 'gp' }
const fantasyprosStats = { PTS: 'pts', REB: 'reb', AST: 'ast', BLK: 'blk', STL: 'stl', '3PM': 'tpm', TO: 'to', GP: 'gp' }
const round = (value) => Math.round(value * 100) / 100

// Names a source spells differently from Sleeper, after normalizing.
const aliases = {
  'nicolas claxton': 'nic claxton',
  'herbert jones': 'herb jones',
  'alexandre sarr': 'alex sarr',
  'bub carrington': 'carlton carrington',
  'cam johnson': 'cameron johnson',
  'pj washington': 'p j washington',
}

async function get(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { 'user-agent': userAgent, ...init.headers } })
  if (!response.ok) throw new Error(`${url}: ${response.status}`)
  return response
}

const decode = (text) =>
  text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&rsquo;|&#8217;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .trim()

export function normalize(name) {
  const key = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’,]/g, '')
    .replace(/-/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return aliases[key] ?? key
}

async function sleeperIndex() {
  const players = await (await get('https://api.sleeper.app/v1/players/nba')).json()
  const projections = await (await get(`https://api.sleeper.app/v1/projections/nba/regular/${season}`)).json()
  const byName = new Map()
  for (const [id, player] of Object.entries(players)) {
    const name = player.full_name ?? `${player.first_name ?? ''} ${player.last_name ?? ''}`
    const key = normalize(name)
    // Prefer the projected player, then a rostered one, when two share a name.
    const score = (projections[id]?.pts > 0 ? 2 : 0) + (player.team ? 1 : 0)
    const current = byName.get(key)
    if (!current || score > current.score) byName.set(key, { id, score })
  }
  return (name) => byName.get(normalize(name))?.id
}

async function espnPlayers() {
  const filter = { players: { limit: 400, sortDraftRanks: { sortPriority: 100, sortAsc: true, value: 'STANDARD' } } }
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${season + 1}/segments/0/leaguedefaults/1?view=kona_player_info`
  const data = await (await get(url, { headers: { 'x-fantasy-filter': JSON.stringify(filter) } })).json()
  return data.players.map(({ player }) => player)
}

// STANDARD is ESPN's H2H points rank; ROTO is categories.
function espnRanks(players) {
  return players
    .map((player) => ({ name: player.fullName, rank: player.draftRanksByRankType?.STANDARD?.rank }))
    .filter((row) => row.rank && row.rank < 300)
}

// ESPN's season projection is the stats entry with statSourceId 1 for the coming season.
function espnProjections(players) {
  return players.flatMap((player) => {
    const projection = player.stats?.find((entry) => entry.statSourceId === 1 && entry.seasonId === season + 1 && entry.statSplitTypeId === 0)
    const averages = projection?.averageStats
    if (!averages || !(averages[0] > 0)) return []
    const line = Object.fromEntries(Object.entries(espnStats).map(([statId, key]) => [key, round(averages[statId] ?? 0)]))
    return [{ name: player.fullName, line }]
  })
}

async function fantasyprosProjections() {
  const html = await (await get(sources.fantasypros.url)).text()
  const table = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0]).find((t) => t.includes('3PM')) ?? ''
  const rows = [...table.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((row) => [...row[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((cell) => decode(cell[1])))
  const [heading, ...body] = rows
  return body.map((cells) => {
    // "Shai Gilgeous-Alexander (OKC - PG)"
    const name = cells[0].replace(/\s*\(.*$/, '').trim()
    const line = {}
    heading.forEach((column, index) => {
      const key = fantasyprosStats[column]
      if (key) line[key] = Number(cells[index].replace(/,/g, '')) || 0
    })
    return { name, line }
  })
}

async function rotowireRanks() {
  const page = await (await get(sources.rotowire.url)).text()
  // The page carries a short preview of the article before the full one; read the last copy.
  const html = page.slice(page.lastIndexOf('<h3>Round 1</h3>'))
  const names = [...html.matchAll(/<li><a href="https:\/\/www\.rotowire\.com\/basketball\/player\/[^"]+"><strong>(.*?)<\/strong><\/a>/g)].map((m) => decode(m[1]))
  return names.map((name, index) => ({ name, rank: index + 1 }))
}

async function rotoballerRanks() {
  const html = await (await get(sources.rotoballer.url)).text()
  const table = html.match(/<table[\s\S]*?<\/table>/)?.[0] ?? ''
  return [...table.matchAll(/<tr>\s*<td[^>]*>(\d+)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => ({ name: decode(m[2]), rank: Number(m[1]) }))
}

async function espnTiers() {
  const html = await (await get(sources.tiers.url)).text()
  const positions = ['PG', 'SG', 'SF', 'PF', 'C']
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0])
  if (tables.length !== positions.length) throw new Error(`ESPN tiers: expected 5 tables, found ${tables.length}`)
  const rows = []
  tables.forEach((table, index) => {
    // Two side-by-side columns of tiers; read the left one down, then the right.
    const cells = [...table.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((row) =>
      [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => decode(cell[1])),
    )
    const columns = [cells.map((row) => row[1] ?? ''), cells.map((row) => row[3] ?? '')]
    let tier = 0
    let order = 0
    for (const value of columns.flat()) {
      const heading = value.match(/^TIER (\d+)$/i)
      if (heading) tier = Number(heading[1])
      else if (value && tier) rows.push({ name: value, position: positions[index], tier, order: ++order })
    }
  })
  return rows
}

const sleeperId = await sleeperIndex()
const players = {}
const unmatched = {}
const counts = {}
const entry = (id) => (players[id] ??= {})

const espn = await espnPlayers()
const ranked = { espn: espnRanks(espn), rotowire: await rotowireRanks(), rotoballer: await rotoballerRanks() }
for (const [key, rows] of Object.entries(ranked)) {
  if (rows.length < 140) throw new Error(`${key}: only ${rows.length} players parsed, the page has probably changed`)
  counts[key] = rows.length
  for (const row of rows) {
    const id = sleeperId(row.name)
    if (id) entry(id)[key] = row.rank
    else (unmatched[key] ??= []).push(row.name)
  }
}

const tiers = await espnTiers()
counts.tiers = tiers.length
for (const row of tiers) {
  const id = sleeperId(row.name)
  if (id) (entry(id).tiers ??= []).push({ position: row.position, tier: row.tier, rank: row.order })
  else (unmatched.tiers ??= []).push(row.name)
}

const projected = { espnProjection: espnProjections(espn), fantasypros: await fantasyprosProjections() }
for (const [key, rows] of Object.entries(projected)) {
  if (rows.length < 150) throw new Error(`${key}: only ${rows.length} projections parsed, the source has probably changed`)
  counts[key] = rows.length
  for (const row of rows) {
    const id = sleeperId(row.name)
    if (id) (entry(id).projections ??= {})[key] = row.line
    else (unmatched[key] ??= []).push(row.name)
  }
}

await writeFile(out, `${JSON.stringify({ fetchedAt: new Date().toISOString(), sources, players }, null, 1)}\n`)

for (const [key, count] of Object.entries(counts)) {
  const missed = unmatched[key] ?? []
  console.log(`${key.padEnd(15)} ${count} players${missed.length ? `, unmatched: ${missed.join(', ')}` : ''}`)
}
