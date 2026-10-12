-- Server-only cache for AI editorial ranking of already-verified Smart Deck candidates.
-- No client role can read/write this table; the Edge Function uses service_role.
create table if not exists public.smart_deck_editorial_cache (
  cache_key text primary key check (length(cache_key) = 64),
  language text not null check (language in ('ru', 'en')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists smart_deck_editorial_cache_expiry_idx
  on public.smart_deck_editorial_cache (expires_at);

alter table public.smart_deck_editorial_cache enable row level security;
revoke all on public.smart_deck_editorial_cache from anon, authenticated;
grant all on public.smart_deck_editorial_cache to service_role;

comment on table public.smart_deck_editorial_cache is
'Cached AI editorial copy/ranking for server-validated Smart Decks. Not a source of football facts.';
