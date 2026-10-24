# ECTOcooler Hoops Project Context

## Product

A draft board for **Beer League Basketball**, a 12-team Sleeper NBA league (league `1388653441982664704`, 2026 season). The owner is DTHOR48 (`1388653871391318016`), team ThorbergBC, drafting from slot 10 in a 16-round snake. It is the basketball sibling of ECTOcooler (`~/Sites/fantasyfootballapp`) and ECTOcooler Golf (`~/Sites/golfapp`).

## Stack

React, TypeScript and Vite on Vercel, with Clerk and Supabase, the same services as football and golf. Every one of them is a separate project, though: own GitHub repo, Vercel project, Supabase project and Clerk application, on `hoops.ectocooler.com`. [SETUP.md](SETUP.md) walks through creating them.

Sleeper's API is public and sends `access-control-allow-origin: *`, so all league data is read in the browser with no backend. Sign-in is optional: `src/Root.tsx` renders the board without Clerk when `VITE_CLERK_PUBLISHABLE_KEY` is missing or a placeholder, rather than the golf app's configuration screen, so the board never depends on the auth setup.

```bash
npm install
npm run dev
npm run lint
npm run build
```

## League

- Lineup: PG, SG, G, SF, PF, F, C, UTIL ×3, six bench, two IR.
- Points scoring, read live from the league's `scoring_settings`, never hardcoded: PTS 1, REB 1.5, AST 2, STL 2, BLK 3, TO −1, 3PM 0.5, DD 2, TD 5, plus +2 for 40 and 50 point, 15 assist and 20 rebound games.
- Playoffs: six teams from week 19. Trade deadline week 16. League-median matchup on.

## Data

All from `src/lib/sleeper.ts`:

- `/players/nba`: identity, `fantasy_positions`, `injury_status`. About 2.5 MB, fetched once per load.
- `/projections/nba/regular/<season>`: a per-game line (`gp` is 1) with `adp_std` and `adp_dynasty`. `adp_std` of 999 means no ADP.
- `/stats/nba/regular/<season - 1>`: last season's totals, including the `bonus_*` game counts.
- `/league/<id>`, `/league/<id>/users`, `/league/<id>/rosters`, `/draft/<id>`, `/draft/<id>/picks`, `/draft/<id>/traded_picks`.

Outside sources come from a snapshot, `src/data/rankings.json`, that `npm run rankings` (`scripts/rankings.mjs`) rebuilds: ESPN's fantasy API (points draft rank and per-game projections), FantasyPros' consensus per-game projections, RotoWire's and RotoBaller's points top 150s, and ESPN's positional tier article. Names are matched to Sleeper ids, projections are stored under Sleeper's stat keys so the board scores them with the league's live `scoring_settings`, and the script refuses to write if a source parses short. Rerun it and commit to refresh.

`scoreLine` in `src/lib/scoring.ts` is a dot product of a stat line with `scoring_settings`; Sleeper's stat and scoring keys share names. Projections have no `bonus_*` keys, so projected points leave those bonuses out.

## Board

- Rank orders Cons FP/G: projected fantasy points per game in league scoring, averaged across Sleeper, ESPN and FantasyPros. It is fixed at load and does not move as players are drafted. Each source's number is in the Cons FP/G tooltip.
- ESPN and FantasyPros project no `dd`/`td`, so their lines borrow Sleeper's per-game rates before scoring; otherwise the 2 and 5 point bonuses read as a gap between sources.
- Sleeper projects nothing for some players (rookies such as Lendeborg and Acuff Jr., Lillard back from his Achilles). They are on the board anyway when ESPN or FantasyPros projects them (`projectedIds`), valued on those alone with no double-double rate. Before, they read 0.0 FP/G everywhere.
- Proj GP is the mean of ESPN's and FantasyPros' projected games (Sleeper projects none), orange under 60.
- Experts averages ESPN, RotoWire and RotoBaller points-league ranks. Those publish only an order, so they cannot be rescored. Tier is ESPN's points draft tier for the position; sorting by Tier under a position filter turns the board into that position's cheat sheet with tier dividers.
- ADP gap is `adp_std - rank`, shown only for players ranked inside the draftable pool (teams × roster size, 192). Without the cut-off the column sorts to undraftable players.
- "At #N" compares standard ADP to the owner's pick after next, a rough guess at who survives the turn.
- Last GP under 50 is shown in orange as a durability flag.
- Stars always live in `localStorage` (`hoops.starred`). Signed in, they are also kept in Supabase `starred_players` keyed on the Clerk user id; sign-in merges this browser's stars into the table, and each toggle writes through.

## Live draft

The draft is polled every 3 s while `drafting`, every 30 s before it starts or while paused, and not at all once `complete`. `rosterForPick` in `src/lib/draft.ts` works out who owns each pick from snake order, `reversal_round` and traded picks. `assignLineup` fills the starting slots most-constrained first, so a PG/SG does not take the PG slot from a pure PG.

`?draft=<id>&user=<user_id>` replays another draft for testing. Last season's league (BS Basketball, `1260852226524454912`) has a complete 192-pick draft: `?draft=1260852226528657408&user=337522748299411456`. Scoring and lineup still come from Beer League.

## My lineup

Beer League plays Sleeper's **Lock-In** mode (`game_mode` 1): each starter scores one game per week, the one the manager locks after it is played, or his last game of the week if none is locked. Last season's matchups confirm it: starters score 20 to 60 a week, one game's worth, not three or four games added up. So games are not added together. A player with no game that week scores nothing, and every extra game is another chance at a big night to lock.

- The schedule is Sleeper's own, `api.sleeper.app/schedule/nba/regular/<season>` (outside `/v1`, still public and CORS-open). Every game carries its fantasy `week`, so weeks need no date maths. Most run Monday to Sunday; week 1 starts on opening night, and the NBA Cup and All-Star breaks make weeks 7, 8, 18 and 19 short.
- `lockValues` in `src/lib/lineup.ts` is the expected locked score with n games, locking optimally: one game is worth FP/G, and value(n + 1) = E[max(game, value(n))], with a game's score normal around FP/G at a 30% spread (`gameSpread`). A 40 FP/G player is worth 40, 44.8, 47.6 and 49.5 with one to four games. A simulation agrees.
- `bestLineup` assigns players to slots to maximise the total value (Hungarian algorithm), rather than the draft board's greedy fill. Players listed Out, IR, Sus or NA are valued at 0.
- The lock guide is the same numbers read the other way: after a game with k games still to come, lock it if it beat value(k), capped at 10% over FP/G (`lockBar`, `lockEase`). In theory waiting on three or four games is worth 19 to 24% over FP/G; the cap takes the bird in hand sooner. It only ever lowers the bar, so with one game left the bar is still FP/G. The tags show the margin: "Lock it? +15", "Wait −7".
- The roster is the owner's Sleeper roster once the draft is done, and the players drafted so far until then. Sleeper's current `starters` are compared with the best lineup to list Start / Sit moves. Sleeper has no write API, so the moves are made in the Sleeper app.
- Live sync: rosters are re-read every minute while the page is in view, and at once when it comes back into view (`App.tsx`). The week being played is also re-read every minute (`src/useLiveWeek.ts`): its matchups, the schedule's game statuses and the week's game lines. The table shows the lineup as set in Sleeper, starters in their slots then bench and IR, with a Best lineup toggle. Once a week starts, its own matchup's `starters` and `players` are the lineup, so past weeks show what actually played.
- Clicking a row opens a panel under it (`src/PlayerDetail.tsx`): projected, this season's and last season's FP/G; his latest news; his next five games by fantasy week with each opponent's record; and this season's game log scored in league points. News is RotoWire's notes via `api.sleeper.app/players/nba/<id>/news` and the log is `api.sleeper.app/stats/nba/player/<id>?season=<season>&grouping=week`, both unlisted, public and CORS-open. They are read when the panel opens and kept for the page's life.
- A scoreboard above the table shows both sides of the owner's matchup: Sleeper points, the projection, and a lock count. The owner's side counts starters marked locked plus those with no games left ("7/10 locked"); the opponent's locks aren't public, so it counts starters with no games left ("3/10 done").
- Locks (`src/lib/live.ts`): Sleeper's public API does not publish which game a manager locked, and the GraphQL API that does needs a login. Once a week is over a starter's points are one game's score (the locked one, or else his last), and replaying last season's finished weeks bears that out. On game nights, though, the public matchup can't be trusted to show locks. On Oct 23, 2026 two reads two seconds apart disagreed on three starters, locked players read as their latest game for an hour, and an unlocked one read as an earlier game. Reading locks from the points showed Duren locked when he wasn't and missed Lillard, so the page no longer infers them.
- Marking locks: a lock is the manager's own mark. Right after locking a player in Sleeper, the manager taps Mark locked (or any finished game's score) in the lock guide (`withMark`). Marks live in this browser's `localStorage` (`hoops.lockMarks`, by season, week and player). The Pts column shows the points that count by the page's own reckoning, from the game scores: the marked game, or else his latest. Sleeper's own number is in the tooltip when it differs.
- Mid-week, Proj is the expected final points: the lock if there is one, otherwise the better of locking the latest game now and waiting on the games left. A bench player moved in only has the games still to tip off. Best lineup keeps starters who are locked in or playing right now in their slots.

## League

The homepage is the League page alone, now the draft is over. Each lineup has its own page, `/ThorbergBC`, `/ccanderson99` and `/RimJob` (case doesn't matter), with a League tab beside it; the footer links all three. The draft's board and Teams pages are archived at `/board` and `/teams`, linked from the footer; Teams is built from the draft's picks, so it shows each team as drafted rather than as it stands. `src/League.tsx`:

- Matchups come from `/league/<id>/matchups/<week>`: the two rosters sharing a `matchup_id` play each other. Each side shows its record, its projection and, once the week starts, Sleeper's points and how many starters are done for the week; the live week is re-read every minute. Before the week, the projection is the roster's best lineup valued as on the lineup page (`weekScore`), with IR players left out; once it starts, the expected final score of its actual starters. The league median, which every team also plays, is shown under the cards. Playoff weeks (from `playoff_week_start`) are placeholders in Sleeper, so they show a note instead.
- Standings are each roster's `settings` wins, losses and `fpts`. Sleeper's record counts the median game too, so a season is 36 decisions.
- Top free agents are board players on no roster, ranked by the selected week's lock value (games that week at their Cons FP/G), or by FP/G. Rosters are read once per page load.
- Under the standings, every NBA team's games that week as day dots, most games first, for picking up streamers.
- The NBA schedule is read once per season and shared by both tabs (`src/useWeeks.ts`).

## Lock alerts

`scripts/lock-alerts.ts` posts to Discord when a ThorbergBC starter finishes a game worth locking. It runs the lock guide on a schedule. After a game with k games left that week, the game is worth locking if it scored at least the same `lockBar` as on the page. It never alerts for the week's last game, since Sleeper keeps that one anyway. It also never alerts once the player's next game has tipped off, since the chance to lock has passed. A player listed Out is valued at 0, so any game he played before being ruled out is worth locking.

- Per-game lines come from `api.sleeper.app/stats/nba/<season>/<week>?season_type=regular`: one row per player per game, with the schedule's `game_id` and `date`. Scores use the same `scoreLine`, and players are valued by the same Cons FP/G (`projectedPerGame`) as the board and lineup page.
- It runs under plain Node 24 with no install. That's why `src/lib/lineup.ts` imports `./draft.ts` with its extension, and why the script reads `rankings.json` from disk instead of importing `rankings.ts`.
- `.github/workflows/lock-alerts.yml` runs it every 20 minutes from 17:00 to 07:59 UTC, and it can also be started by hand from the Actions tab. Each run checks the whole week, so a late or dropped GitHub run only delays an alert. The games already alerted live in `.lock-alerts/sent.json`, which the Actions cache carries between runs.
- The webhook is the `DISCORD_WEBHOOK_URL` repository secret. The repo is public, so the webhook must never be committed. Locally it goes in `.env.local`, which `npm run lock-alerts` loads.

```bash
npm run lock-alerts -- --dry-run
npm run lock-alerts -- --dry-run --date 2025-11-05 --league 1260852226524454912 --user 337522748299411456
```

The second command replays a day of last season's league.

## Next

In-season: blend this season's actual FP/G into the projection as games are played.
