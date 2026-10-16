import { useEffect, useState } from 'react'
import { weeksFromSchedule, type Week } from './lib/lineup'
import { getSchedule } from './lib/sleeper'

// Read once per season and shared, so switching between the league and lineup tabs is instant.
const loaded = new Map<string, Week[]>()
const loading = new Map<string, Promise<Week[]>>()

function loadWeeks(season: string) {
  let promise = loading.get(season)
  if (!promise) {
    promise = getSchedule(season).then((games) => {
      const weeks = weeksFromSchedule(games)
      loaded.set(season, weeks)
      return weeks
    })
    // A failed read is not cached, so the next mount tries again.
    promise.catch(() => loading.delete(season))
    loading.set(season, promise)
  }
  return promise
}

// The season's fantasy weeks from Sleeper's NBA schedule.
export function useWeeks(season: string) {
  const [weeks, setWeeks] = useState<Week[] | null>(() => loaded.get(season) ?? null)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    loadWeeks(season)
      .then((built) => {
        if (!cancelled) setWeeks(built)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught))
      })
    return () => {
      cancelled = true
    }
  }, [season])
  return { weeks, error }
}
