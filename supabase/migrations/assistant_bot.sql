-- ============================================================================
-- The assistant bot's memory, and the one person it answers to.
--
-- WHY A SECOND BOT AND NOT THE GAME'S. The Mini App's bot carries the payment
-- webhook and the token that validates every player's initData (in Vault, as
-- `telegram_bot_token`). An assistant is a different blast radius: it runs
-- commands, it holds a model key, and its webhook points somewhere else. They
-- share nothing on purpose — `ASSISTANT_BOT_TOKEN` is its own secret, and
-- replacing `TELEGRAM_BOT_TOKEN` would have broken tg-pay's invoices.
--
-- WHO IT ANSWERS TO. Trust on first use: the first person who writes to a
-- brand-new bot nobody else knows about is its owner, and the row is then
-- fixed. That is a real window, and it is small and self-closing — but it is
-- a window, so the binding is recorded with a timestamp and can be undone
-- with one DELETE. Everyone else is ignored in silence: an "access denied"
-- reply tells a stranger the bot is real and worth pushing on.
--
-- GRANTS: written out in both directions, because silence is not a decision.
-- Only the service role reaches these tables, which is the shape fixture_odds
-- and player_encounters already use. Note the lesson that cost the deck an
-- outage this morning: a policy WITHOUT a grant is a table nobody can read.
-- Here we want exactly that for anon and authenticated — but the REVOKE is
-- spelled out rather than left implicit, because Supabase ships
-- `alter default privileges ... grant all on tables to anon, authenticated`
-- for tables created by `postgres`, so "I wrote no grant" does NOT reliably
-- mean "there is no grant". Whether the default fires depends on which role
-- ran the migration, which is not something a reader of this file can see.
-- The same reasoning is why service_role's access is granted here explicitly
-- instead of assumed: the bot is the only reader, and it must not depend on a
-- default either.
-- ============================================================================

create table if not exists public.assistant_owner (
  -- One row, forever: the primary key is a constant.
  singleton    boolean primary key default true check (singleton),
  telegram_id  bigint not null,
  bound_at     timestamptz not null default now()
);

comment on table public.assistant_owner is
  'The single Telegram account the assistant bot replies to. Bound on first '
  'contact. To rebind: delete the row and message the bot again.';

create table if not exists public.assistant_chat (
  id           bigserial primary key,
  telegram_id  bigint not null,
  -- 'user' or 'assistant' — the two roles the Messages API takes in `messages`.
  role         text   not null check (role in ('user', 'assistant')),
  content      text   not null,
  created_at   timestamptz not null default now()
);

create index if not exists assistant_chat_recent_idx
  on public.assistant_chat (telegram_id, id desc);

comment on table public.assistant_chat is
  'Conversation history. The Messages API is stateless, so every request '
  'resends the tail of this table — see HISTORY_TURNS in the function.';

alter table public.assistant_owner enable row level security;
alter table public.assistant_chat  enable row level security;

-- No policies: with RLS on, that alone denies anon and authenticated even if a
-- grant existed. The revokes below close the other gate as well, so neither a
-- future default privilege nor a stray `grant all on all tables` can reopen it.
revoke all on public.assistant_owner from public, anon, authenticated;
revoke all on public.assistant_chat  from public, anon, authenticated;
revoke all on sequence public.assistant_chat_id_seq from public, anon, authenticated;

-- The bot is the only writer and the only reader. `revoke ... from public`
-- above also strips service_role of anything it inherited through PUBLIC, so
-- these three lines are what actually keeps the function working.
grant select, insert, update, delete on public.assistant_owner to service_role;
grant select, insert, delete        on public.assistant_chat  to service_role;
grant usage, select on sequence public.assistant_chat_id_seq  to service_role;
