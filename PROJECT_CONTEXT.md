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
- The lock guide is the same numbers read the other way: after a game with k games still to come, lock it if it beat value(k).
- The roster is the owner's Sleeper roster once the draft is done, and the players drafted so far until then. Sleeper's current `starters` are compared with the best lineup to list Start / Sit moves. Sleeper has no write API, so the moves are made in the Sleeper app.

## Lock alerts

`scripts/lock-alerts.ts` posts to Discord when a ThorbergBC starter finishes a game worth locking. It runs the lock guide on a schedule. After a game with k games left that week, the game is worth locking if it scored at least value(k), rounded up as on the page. It never alerts for the week's last game, since Sleeper keeps that one anyway. It also never alerts once the player's next game has tipped off, since the chance to lock has passed. A player listed Out is valued at 0, so any game he played before being ruled out is worth locking.

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

In-season: blend this season's actual FP/G into the projection as games are played, free agents ranked by next week's lock value, and the weekly matchup.
