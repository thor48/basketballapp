-- ECTOcooler Hoops — full schema.
--
-- Safe to run repeatedly: every statement is guarded. Run it in the Supabase SQL editor of the
-- hoops project, not the football or golf one.
--
-- Identity comes from Clerk, so `user_id` is the Clerk `user_...` string and every policy reads
-- `auth.jwt() ->> 'sub'`, as in the football and golf apps. The Clerk Supabase integration must be
-- on for each Clerk instance, and that instance's domain registered under Supabase Third-Party
-- Auth, or requests arrive as `anon` and these policies return nothing.

-- ---------------------------------------------------------------------------
-- Starred players — one row per star, so a star follows the user across devices
-- ---------------------------------------------------------------------------

-- `player_id` is Sleeper's NBA player id, the key every Sleeper endpoint uses.
create table if not exists public.starred_players (
  user_id text not null,
  player_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, player_id)
);

alter table public.starred_players enable row level security;

drop policy if exists "Read own stars" on public.starred_players;
create policy "Read own stars" on public.starred_players for select
  using (user_id = auth.jwt() ->> 'sub');

drop policy if exists "Insert own stars" on public.starred_players;
create policy "Insert own stars" on public.starred_players for insert
  with check (user_id = auth.jwt() ->> 'sub');

-- Upsert of an existing star is an update, so it needs this as well as insert.
drop policy if exists "Update own stars" on public.starred_players;
create policy "Update own stars" on public.starred_players for update
  using (user_id = auth.jwt() ->> 'sub')
  with check (user_id = auth.jwt() ->> 'sub');

drop policy if exists "Delete own stars" on public.starred_players;
create policy "Delete own stars" on public.starred_players for delete
  using (user_id = auth.jwt() ->> 'sub');
