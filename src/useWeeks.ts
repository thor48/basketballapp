import { useEffect, useState } from 'react'
import { weeksFromSchedule, type Week } from './lib/lineup'
import { getSchedule, type ScheduleGame } from './lib/sleeper'

type Season = { weeks: Week[]; games: ScheduleGame[] }

// Read once per season and shared, so switching between the league and lineup tabs is instant.
const loaded = new Map<string, Season>()
const loading = new Map<string, Promise<Season>>()

function loadSeason(season: string) {
  let promise = loading.get(season)
  if (!promise) {
    promise = getSchedule(season).then((games) => {
      const built = { weeks: weeksFromSchedule(games), games }
      loaded.set(season, built)
      return built
    })
    // A failed read is not cached, so the next mount tries again.
    promise.catch(() => loading.delete(season))
    loading.set(season, promise)
  }
  return promise
}

// The season's fantasy weeks from Sleeper's NBA schedule, and its games. Game statuses are as
// of the read; the live week re-reads them (useLiveWeek).
export function useWeeks(season: string) {
  const [data, setData] = useState<Season | null>(() => loaded.get(season) ?? null)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    loadSeason(season)
      .then((built) => {
        if (!cancelled) setData(built)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught))
      })
    return () => {
      cancelled = true
    }
  }, [season])
  return { weeks: data?.weeks ?? null, games: data?.games ?? null, error }
}
