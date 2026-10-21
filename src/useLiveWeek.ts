import { useEffect, useState } from 'react'
import { liveWeek, type LiveWeek } from './lib/live'
import { usToday, type Week } from './lib/lineup'
import { getMatchups, getSchedule, getWeekGameLines, type Matchup } from './lib/sleeper'

export type WeekSnapshot = {
  // Null when matchups were not asked for.
  matchups: Matchup[] | null
  // Null before the week starts, when there is nothing to score.
  live: LiveWeek | null
  checkedAt: number
}

// A fantasy week's matchups, lineups and game-by-game scores from Sleeper. The week being played
// is re-read every minute while the page is in view, and at once when it comes back into view;
// a past week is read once. Each week read is kept, so paging back to one is instant.
export function useLiveWeek(leagueId: string, season: string, week: Week | null, readMatchups: boolean) {
  const [snapshots, setSnapshots] = useState<Record<number, WeekSnapshot>>({})
  const today = usToday()
  const weekNumber = week?.week
  const started = !!week && week.start <= today
  const live = started && !!week && today <= week.end

  useEffect(() => {
    if (weekNumber === undefined) return
    let cancelled = false
    const load = () =>
      Promise.all([
        readMatchups ? getMatchups(leagueId, weekNumber) : null,
        started ? getSchedule(season) : null,
        started ? getWeekGameLines(season, weekNumber) : null,
      ])
        .then(([matchups, schedule, lines]) => {
          if (cancelled) return
          const snapshot = { matchups, live: schedule && lines ? liveWeek(schedule, weekNumber, lines) : null, checkedAt: Date.now() }
          setSnapshots((current) => ({ ...current, [weekNumber]: snapshot }))
        })
        .catch(() => {
          // A missed read is retried on the next tick or week change.
        })
    load()
    if (!live) return () => {
      cancelled = true
    }
    const refresh = () => {
      if (!document.hidden) load()
    }
    const timer = window.setInterval(refresh, 60000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [leagueId, season, weekNumber, readMatchups, started, live])

  return { snapshot: weekNumber === undefined ? null : (snapshots[weekNumber] ?? null), started, live }
}
