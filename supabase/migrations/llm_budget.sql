-- Потолок расхода модели — ТАКОЙ ЖЕ ЖЁСТКИЙ, как у odds-api.
--
-- ЧЕГО НЕ БЫЛО. У пути в the-odds-api потолок есть и он неперешагиваем:
-- `spend_odds_credits` РЕЗЕРВИРУЕТ до вызова, и кончившийся бюджет
-- останавливает работу, а не перерасходует. У пути в модель не было ничего —
-- ни на пачку, ни на сутки.
--
-- ЧЕМ ЭТО КОНЧИЛОСЬ, ЗАМЕРЕНО. `football-digest` ходит в модель ПО КАЖДОЙ
-- новости, параллельно, и `candidates = rows.filter(...)` без предела: крон
-- раз в десять минут, поймав разом сотню свежих новостей, выпускает сотню
-- параллельных запросов в одну минуту. За сутки 863 новости с сутью, за
-- неделю 2436. Владелец увидел в панели шлюза «90% токенов за десять минут»
-- и решил, что украли ключ. Ключ не крали — потолка не было.
--
-- ⚠️ СЧИТАЮТСЯ ВЫЗОВЫ, А НЕ ТОКЕНЫ, И ЭТО СОЗНАТЕЛЬНО. Токены известны
-- только ПОСЛЕ ответа, а резервировать надо ДО — иначе это не потолок.
-- Вызов у обеих функций ограничен сверху (`max_tokens` 300 и 2000), поэтому
-- число вызовов — честная верхняя оценка расхода.
--
-- ⚠️ СУТКИ, А НЕ МЕСЯЦ. У odds-api ограничение месячное, потому что таков
-- тариф провайдера. Здесь беда была суточная — сгореть за десять минут, — и
-- месячный потолок её бы не поймал: он допускает выжечь всё первого числа.

create table if not exists public.llm_budget (
  day        date primary key,
  calls      integer not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.llm_budget is
  'Сколько вызовов модели израсходовано за сутки. Резервируется ДО вызова, '
  'как odds_api_budget.';

grant select on public.llm_budget to service_role;

-- Потолок в одном месте. 1200 — выше замеренных 863 за сутки, то есть
-- обычный день не режется; ловится ИМЕННО выброс.
create or replace function public.llm_daily_limit()
returns integer language sql immutable
set search_path = public
as $$ select 1200 $$;

create or replace function public.llm_calls_left()
returns integer language sql stable
security definer set search_path = public
as $$
  select greatest(0, llm_daily_limit() - coalesce(
    (select calls from llm_budget where day = (now() at time zone 'utc')::date), 0));
$$;

-- ⚠️ РЕЗЕРВ ДО ВЫЗОВА. Возвращает false — звонить НЕЛЬЗЯ. Атомарно:
-- insert-on-conflict берёт блокировку строки, поэтому две параллельные
-- ветки не могут обе проскочить последний вызов. Именно параллельность и
-- сожгла бюджет: сотня `Promise.all` в одну минуту.
create or replace function public.spend_llm_calls(p_calls integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day   date := (now() at time zone 'utc')::date;
  v_after integer;
begin
  if p_calls is null or p_calls < 0 then
    raise exception 'calls must be zero or more' using errcode = '22023';
  end if;
  if p_calls = 0 then
    return true;
  end if;

  insert into llm_budget (day, calls) values (v_day, 0)
  on conflict (day) do update set day = excluded.day
    returning calls into v_after;

  if v_after + p_calls > llm_daily_limit() then
    return false;
  end if;

  update llm_budget set calls = calls + p_calls, updated_at = now() where day = v_day;
  return true;
end;
$$;

comment on function public.spend_llm_calls(integer) is
  'Резервирует вызовы модели ДО обращения к ней. false — потолок суток '
  'исчерпан, звонить нельзя. Атомарна: параллельные ветки не проскочат.';

revoke all on function public.spend_llm_calls(integer) from public, anon, authenticated;
grant execute on function public.spend_llm_calls(integer) to service_role;
revoke all on function public.llm_calls_left() from public;
grant execute on function public.llm_calls_left() to anon, authenticated, service_role;
