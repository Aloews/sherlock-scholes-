-- Chat-native quiz sessions for Telegram Rich Messages.
-- Only the trusted tg-pay Edge Function may read or mutate these rows.
create table if not exists public.telegram_chat_quiz_sessions (
  session_key text primary key
    check (session_key ~ '^[0-9a-f]{16}$'),
  chat_id bigint not null,
  created_by bigint not null,
  message_id bigint,
  language_code text not null default 'ru',
  answer_id uuid not null,
  facts jsonb not null check (jsonb_typeof(facts) = 'object'),
  options jsonb not null check (jsonb_typeof(options) = 'array'),
  chosen_option_id uuid,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  check (answered_at is null or chosen_option_id is not null)
);

create index if not exists telegram_chat_quiz_sessions_expiry_idx
  on public.telegram_chat_quiz_sessions (expires_at);

create index if not exists telegram_chat_quiz_sessions_chat_idx
  on public.telegram_chat_quiz_sessions (chat_id, created_at desc);

alter table public.telegram_chat_quiz_sessions enable row level security;

revoke all on table public.telegram_chat_quiz_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.telegram_chat_quiz_sessions to service_role;

drop policy if exists telegram_chat_quiz_sessions_service_role on public.telegram_chat_quiz_sessions;
create policy telegram_chat_quiz_sessions_service_role
  on public.telegram_chat_quiz_sessions
  for all
  to service_role
  using (true)
  with check (true);
