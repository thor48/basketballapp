import type { Draft, TradedPick } from './sleeper'

export type Slot = 'PG' | 'SG' | 'G' | 'SF' | 'PF' | 'F' | 'C' | 'UTIL' | 'BN'

// Which player positions each lineup slot accepts.
const slotAccepts: Record<Slot, string[] | null> = {
  PG: ['PG'],
  SG: ['SG'],
  G: ['PG', 'SG'],
  SF: ['SF'],
  PF: ['PF'],
  F: ['SF', 'PF'],
  C: ['C'],
  UTIL: null,
  BN: null,
}

export const fitsSlot = (slot: string, positions: string[]) => {
  const accepts = slotAccepts[slot as Slot]
  return accepts === undefined ? false : accepts === null || positions.some((position) => accepts.includes(position))
}

// The draft slot that picks at overall pick `pickNo`. Snake order, with Sleeper's third-round
// reversal: from `reversal_round` on, the direction is flipped once more.
export function slotForPick(pickNo: number, draft: Draft) {
  const teams = draft.settings.teams
  const round = Math.ceil(pickNo / teams)
  const index = (pickNo - 1) % teams
  const reversal = draft.settings.reversal_round ?? 0
  let forward = round % 2 === 1
  if (reversal > 0 && round >= reversal) forward = !forward
  if (draft.type === 'linear') forward = true
  return forward ? index + 1 : teams - index
}

// The roster that owns overall pick `pickNo`, following any traded picks.
export function rosterForPick(pickNo: number, draft: Draft, traded: TradedPick[]) {
  const slot = slotForPick(pickNo, draft)
  const original = draft.slot_to_roster_id?.[String(slot)]
  if (original === undefined) return undefined
  const round = Math.ceil(pickNo / draft.settings.teams)
  const trade = traded.find((pick) => pick.round === round && pick.roster_id === original)
  return trade ? trade.owner_id : original
}

// Fills the starting lineup from a drafted list. The most constrained slots are filled first,
// and within a slot the player with the fewest eligible positions goes first, so a PG/SG does not
// take the PG slot from a pure PG. Whatever is left goes to the bench.
export function assignLineup<T extends { positions: string[] }>(rosterPositions: string[], players: T[]) {
  const starters = rosterPositions.filter((slot) => slot !== 'BN' && slot !== 'IR')
  const order: Slot[] = ['C', 'PG', 'SG', 'SF', 'PF', 'G', 'F', 'UTIL']
  const filled = new Map<number, T>()
  const remaining = [...players]
  for (const slot of order) {
    starters.forEach((name, index) => {
      if (name !== slot || filled.has(index)) return
      const candidates = remaining.filter((player) => fitsSlot(slot, player.positions))
      if (!candidates.length) return
      candidates.sort((a, b) => a.positions.length - b.positions.length)
      const chosen = candidates[0]
      filled.set(index, chosen)
      remaining.splice(remaining.indexOf(chosen), 1)
    })
  }
  return {
    starters: starters.map((slot, index) => ({ slot, player: filled.get(index) })),
    bench: remaining,
  }
}
