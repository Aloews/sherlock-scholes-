-- ============================================================================
-- Play a club's current squad.
--
-- WHERE "CURRENT" COMES FROM, and what it honestly means. Nobody sells us a
-- squad list. What we already hold is the career table from each player's
-- Wikipedia article, and in it a club whose year range is left OPEN — "2012–"
-- rather than "2012–2014" — is the club they had not left when that article
-- was last read. That is the whole signal, and it is a good one: 1160 of 2649
-- players have it.
--
-- It is NOT a live squad. A transfer that happened last week is not here until
-- the article says so and the nightly enrichment picks it up. So the screen
-- must say "as of <date>" and never imply otherwise — the same rule that made
-- us drop wiki as a source of live scores. A stale fact presented as current
-- is the lie; a stale fact presented as stale is just a fact.
--
-- WHY A TABLE AND NOT A VIEW OVER THE JSON. `cards_matching` runs on every
-- deck count and every deal, and unpacking a JSON array for 2649 rows each
-- time to answer "is this player at Valencia" is work done thousands of times
-- to produce an answer that changes once a night.
--
-- MULTIPLE OPEN RANGES ARE NORMAL — a loan, a reserve side, a national team
-- row that slipped in. Valencia and "Valencia B" can both be open. The one
-- with the most appearances wins, which is the first team in every case we
-- looked at.
-- ============================================================================

create table if not exists public.card_current_club (
  card_id    uuid primary key references public.cards(id) on delete cascade,
  -- As the article spells it. Kept verbatim so a human can check the source.
  club       text not null,
  -- What the filter matches on. Both sides are built by the same function
  -- from the same column, so exact equality is safe here — unlike matching
  -- against another provider's spelling, which is what `upsert_fixtures`
  -- resolves by name in fixtures_and_odds.sql. (This comment used to point at
  -- src/features/fixtures/clubMatching.ts, which has never existed: the
  -- fixtures pipeline has a server half and no client half yet.)
  club_key   text not null,
  apps       integer,
  -- Which column it was derived from, so a wrong entry can be traced back.
  source     text not null,
  fetched_at timestamptz not null default now()
);

create index if not exists card_current_club_key_idx on public.card_current_club (club_key);

comment on table public.card_current_club is
  'The club a player had not left when their article was last read. Derived '
  'from an open-ended year range in cards.career_stats / legend_career — not '
  'a live squad, and the UI must say as-of rather than imply freshness.';

-- ---------------------------------------------------------------------------
-- The key a club name is matched by.
--
-- Deliberately mild: both sides come from the same column, so this only has to
-- absorb punctuation and case, not reconcile two vendors' spellings.
-- ---------------------------------------------------------------------------
-- Club CARDS carry the affixes ("Arsenal F.C.", "FC Barcelona", "Real Madrid
-- CF"); career tables use bare names ("Arsenal", "Barcelona", "Real Madrid").
-- Without stripping them a squad never finds its own crest — 2 of 51 matched
-- before this, 37 after.
--
-- Dots go FIRST, so "F.C." collapses to "fc" rather than to two stray letters
-- that would be far too dangerous to drop on their own.
--
-- "FC Arsenal Tula" becomes "arsenal tula" and still does not collide with
-- "arsenal". That is what makes stripping safe rather than reckless: an affix
-- carries no meaning, and the rest of the name carries all of it.
create or replace function public.club_match_key(p_name text)
returns text
language sql immutable
as $$
  with bare as (
    select btrim(regexp_replace(
             regexp_replace(lower(coalesce(p_name, '')), '\.', '', 'g'),
             '[^a-z0-9]+', ' ', 'g')) as s
  ),
  words as (
    select s, string_to_array(s, ' ') as w from bare
  ),
  kept as (
    select s,
           array_remove(
             array(
               select x from unnest(w) as x
               where x <> '' and x not in (
                 'fc','afc','cf','sc','ac','as','ss','ssc','sv','vfb','vfl',
                 'fk','cd','ud','rc','rcd','bsc','tsg','psv','nk','hnk',
                 'club','calcio','ssd','us','usc','sk','bk','if','ik'
               )
             ), null) as w2
    from words
  )
  -- A name made only of affixes keeps its original words: reducing it to
  -- nothing would make it match every other husk.
  select nullif(btrim(case when cardinality(w2) > 0 then array_to_string(w2, ' ') else s end), '')
  from kept
$$;

-- ---------------------------------------------------------------------------
-- rebuild_card_current_clubs — recompute the whole table from the cards.
--
-- Wholesale rather than incremental: it is a few thousand rows, it runs after
-- the nightly enrichment, and a partial rebuild would leave a player at a club
-- they left. Returns how many rows it wrote, so the caller can see it worked.
-- ---------------------------------------------------------------------------
create or replace function public.rebuild_card_current_clubs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with open_ranges as (
    -- career_stats is a bare array of {club, years, apps, goals}.
    select c.id as card_id,
           e->>'club'          as club,
           (e->>'apps')::int   as apps,
           'career_stats'      as source
    from cards c
    cross join lateral jsonb_array_elements(c.career_stats) e
    where c.category = 'player'
      and jsonb_typeof(c.career_stats) = 'array'
      and (e->>'years') ~ '^[0-9]{4}\s*[–-]\s*$'

    union all

    -- legend_career keeps its clubs under a key, and carries no appearances.
    select c.id,
           e->>'club',
           null::int,
           'legend_career'
    from cards c
    cross join lateral jsonb_array_elements(c.legend_career->'clubs') e
    where c.category = 'player'
      and jsonb_typeof(c.legend_career->'clubs') = 'array'
      and (e->>'years') ~ '^[0-9]{4}\s*[–-]\s*$'
  ),
  best as (
    -- One row per player. Most appearances wins; career_stats beats
    -- legend_career when neither has a number, because it is the richer
    -- source and the one the enrichment keeps current.
    select distinct on (card_id)
           card_id, club, apps, source
    from open_ranges
    where club_match_key(club) is not null
    order by card_id, apps desc nulls last,
             (source = 'career_stats') desc
  )
  insert into card_current_club (card_id, club, club_key, apps, source, fetched_at)
  select card_id, club, club_match_key(club), apps, source, now()
  from best
  on conflict (card_id) do update set
    club       = excluded.club,
    club_key   = excluded.club_key,
    apps       = excluded.apps,
    source     = excluded.source,
    fetched_at = excluded.fetched_at;

  get diagnostics v_count = row_count;

  -- A player who left, or whose article stopped saying so, must stop being in
  -- a squad. Without this the table only ever grows and yesterday's squads
  -- stay playable forever.
  delete from card_current_club cc
   where not exists (
     select 1 from cards c
     cross join lateral jsonb_array_elements(c.career_stats) e
     where c.id = cc.card_id
       and jsonb_typeof(c.career_stats) = 'array'
       and (e->>'years') ~ '^[0-9]{4}\s*[–-]\s*$'
   )
   and not exists (
     select 1 from cards c
     cross join lateral jsonb_array_elements(c.legend_career->'clubs') e
     where c.id = cc.card_id
       and jsonb_typeof(c.legend_career->'clubs') = 'array'
       and (e->>'years') ~ '^[0-9]{4}\s*[–-]\s*$'
   );

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- deck_squads — the clubs worth offering, with how many players each has.
--
-- `p_min` exists because a squad of three is not a deck. The picker asks for
-- a floor and gets only clubs that can actually fill a game; offering the rest
-- would be offering a button that produces an empty round.
--
-- Also returns the club CARD when one is recognisable by name, so the picker
-- can show a crest and a translated name. Optional on purpose: fewer than half
-- our club names match a card, and a squad is perfectly playable without one.
-- ---------------------------------------------------------------------------
create or replace function public.deck_squads(p_min integer default 8)
returns table (
  club_key    text,
  club        text,
  players     integer,
  card_id     uuid,
  fetched_at  timestamptz
)
language sql stable
set search_path = public
as $$
  with counted as (
    select cc.club_key,
           -- The spelling most of the players use, rather than whichever row
           -- happens to sort first.
           mode() within group (order by cc.club) as club,
           count(*)::int                          as players,
           max(cc.fetched_at)                     as fetched_at
    from card_current_club cc
    join cards c on c.id = cc.card_id and c.active
    group by cc.club_key
  )
  select n.club_key, n.club, n.players,
         (select k.id from cards k
           where k.category = 'club' and k.active
             and club_match_key(k.name_en) = n.club_key
           limit 1) as card_id,
         n.fetched_at
  from counted n
  where n.players >= greatest(coalesce(p_min, 8), 1)
  order by n.players desc, n.club;
$$;

alter table public.card_current_club enable row level security;
drop policy if exists card_current_club_read on public.card_current_club;
create policy card_current_club_read on public.card_current_club
  for select to anon, authenticated using (true);

-- THE GRANT IS NOT OPTIONAL, AND ITS ABSENCE TOOK THE GAME DOWN.
--
-- A policy and a grant are two different gates, and Postgres checks the GRANT
-- first: without it the caller gets `42501 permission denied` before the
-- policy is ever consulted. This file shipped with the policy and without the
-- grant, and the policy above says exactly what was intended — anyone may
-- read — so the omission read as complete on every review.
--
-- What made it fatal rather than cosmetic: `cards_matching` references this
-- table, and cards_matching is `LANGUAGE sql STABLE` with NO SECURITY
-- DEFINER, so it runs as the player. count_deck and pick_random_cards both go
-- through it. So a missing grant on a small lookup table meant no card could
-- be dealt and no counter could be drawn, for everyone, on every platform —
-- and the failure surfaced as "the game won't load", nowhere near this line.
--
-- Adding a table that cards_matching touches? Grant it here, in the same
-- commit, or the deck stops.
grant select on public.card_current_club to anon, authenticated;

-- ⚠️ И `service_role` — ОТДЕЛЬНОЙ СТРОКОЙ, потому что про него забыли ровно
-- здесь. Строка выше была написана вместе с комментарием про обязательность
-- гранта и всё равно перечислила только игроков; выглядела она законченной
-- именно потому, что политика выше говорит «читать может любой», а
-- `service_role` в слово «любой» на глаз попадает.
--
-- Postgres так не считает. `sports_ru_stats.py` ходит сервис-ключом и читает
-- эту таблицу в `resolve_slugs`, чтобы понять, у каких карточек вообще есть
-- клуб, — и первый же ночной прогон (17.08, вручную после того, как крон не
-- зарегистрировался) упал на ней с `403 Forbidden` ПОСЛЕ того, как обошёл
-- 178 страниц клубов и собрал 87 карточек. То есть вся полезная работа
-- прогона была сделана и выброшена на последнем шаге, а рейтинг остался на
-- посеве.
--
-- Симптом того же класса, что и падение колоды выше, но с другой стороны
-- гранта: там не пускало игрока, здесь — конвейер.
grant select on public.card_current_club to service_role;

revoke all on function public.rebuild_card_current_clubs() from public, anon, authenticated;
grant execute on function public.rebuild_card_current_clubs() to service_role;
grant execute on function public.deck_squads(integer)  to anon, authenticated, service_role;
grant execute on function public.club_match_key(text)  to anon, authenticated, service_role;
