create table if not exists public.smart_deck_builder_usage (
  id bigint generated always as identity primary key,
  player_id bigint not null references public.players(id) on delete cascade,
  used_at timestamptz not null default now()
);

create index if not exists smart_deck_builder_usage_player_time_idx
  on public.smart_deck_builder_usage (player_id, used_at desc);

alter table public.smart_deck_builder_usage enable row level security;
revoke all on public.smart_deck_builder_usage from public, anon, authenticated;

create or replace function public.consume_smart_deck_builder_quota(p_player_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_player_id is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(p_player_id);
  delete from public.smart_deck_builder_usage
  where used_at < now() - interval '1 hour';

  select count(*)::integer into v_count
  from public.smart_deck_builder_usage
  where player_id = p_player_id
    and used_at >= now() - interval '1 hour';

  if v_count >= 10 then
    return false;
  end if;

  insert into public.smart_deck_builder_usage (player_id) values (p_player_id);
  return true;
end;
$$;

revoke all on function public.consume_smart_deck_builder_quota(bigint) from public, anon, authenticated;
grant execute on function public.consume_smart_deck_builder_quota(bigint) to service_role;
