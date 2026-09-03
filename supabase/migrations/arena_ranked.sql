-- ============================================================================
-- Соревновательный режим арены: результаты и таблица.
--
-- ГЛАВНАЯ ЗАДАЧА ЗДЕСЬ НЕ «ЗАПИСАТЬ СЧЁТ», А НЕ ДАТЬ ЕГО ВЫДУМАТЬ. Физику
-- считает хост, то есть один из двух игроков, на его же телефоне. Значит счёт
-- приходит с устройства заинтересованной стороны, и «я выиграл 5:0» — это
-- ровно один POST. Любая таблица, которая верит такому POST, к концу недели
-- состоит из людей, не сыгравших ни одного матча.
--
-- ПОЭТОМУ РЕЗУЛЬТАТ ЗАСЧИТЫВАЕТСЯ ТОЛЬКО ПРИ ВСТРЕЧНОМ ПОДТВЕРЖДЕНИИ.
-- Каждый игрок присылает СВОЙ взгляд на матч: код комнаты, сколько забил и
-- сколько пропустил. Матч попадает в таблицу, когда обе половины сошлись
-- зеркально — мои голы равны его пропущенным и наоборот. Одинокая заявка
-- лежит и не считается: соврать в одиночку можно, но бесполезно, а сговор
-- двоих ради очков в мини-игре — это уже не та угроза, ради которой стоит
-- строить арбитраж.
--
-- Сговор, кстати, всё равно ограничен: пара (код, победитель, проигравший)
-- уникальна, поэтому один код нельзя сдать дважды.
-- ============================================================================

create table if not exists public.arena_result (
  -- Код комнаты. Одноразовый по смыслу: на него приходится один матч.
  code        text   not null,
  telegram_id bigint not null,
  -- Кто был соперником — заполняется, когда встречная половина найдена.
  opponent_id bigint,
  scored      smallint not null,
  conceded    smallint not null,
  -- Сошлась ли пара. Пока false, строка в таблицу лидеров не попадает.
  confirmed   boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (code, telegram_id)
);

create index if not exists arena_result_ranked_idx
  on public.arena_result (created_at desc) where confirmed;

-- ---------------------------------------------------------------------------
-- Заявка на результат.
--
-- `SECURITY DEFINER` и telegram_id ИЗ ПОДПИСАННОГО initData, а не из
-- параметра: иначе достаточно назваться чужим числом, чтобы испортить чужую
-- статистику. Тот же приём, что в `room_invites.sql` и `match_predictions.sql`.
-- ---------------------------------------------------------------------------
create or replace function public.record_arena_result(
  p_init_data text,
  p_code      text,
  p_scored    integer,
  p_conceded  integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    bigint := tg_validate_init_data(p_init_data);
  v_code  text   := upper(nullif(btrim(p_code), ''));
  v_them  record;
begin
  if v_me is null then
    return 'unauthorized';
  end if;
  if v_code is null then
    return 'bad_code';
  end if;
  -- Счёт зажимается: матч идёт до пяти, и «100:0» не бывает даже теоретически.
  if p_scored is null or p_conceded is null
     or p_scored < 0 or p_conceded < 0
     or p_scored > 20 or p_conceded > 20 then
    return 'bad_score';
  end if;

  insert into public.arena_result (code, telegram_id, scored, conceded)
  values (v_code, v_me, p_scored, p_conceded)
  -- Повтор той же заявки безобиден, но переписать УЖЕ ПОДТВЕРЖДЁННЫЙ результат
  -- нельзя: иначе проигравший переигрывал бы историю задним числом.
  on conflict (code, telegram_id) do update
    set scored   = excluded.scored,
        conceded = excluded.conceded
    where not public.arena_result.confirmed;

  -- Встречная половина: тот же код, другой игрок, зеркальный счёт.
  select * into v_them
  from public.arena_result r
  where r.code = v_code
    and r.telegram_id <> v_me
    and r.scored = p_conceded
    and r.conceded = p_scored
  limit 1;

  if not found then
    return 'pending';
  end if;

  update public.arena_result r
     set confirmed = true,
         opponent_id = case when r.telegram_id = v_me then v_them.telegram_id else v_me end
   where r.code = v_code
     and r.telegram_id in (v_me, v_them.telegram_id);

  return 'confirmed';
end;
$$;

-- ---------------------------------------------------------------------------
-- Таблица лидеров за окно в днях.
--
-- Очки: победа 3, ничья 1 — шкала футбольной таблицы, а не выдуманная.
-- Разница мячей вторым ключом, как в настоящем турнире.
-- ---------------------------------------------------------------------------
create or replace function public.arena_leaderboard(
  p_days  integer default 30,
  p_limit integer default 50
)
returns table (
  telegram_id bigint,
  name        text,
  played      integer,
  won         integer,
  drawn       integer,
  lost        integer,
  goals_for   integer,
  goals_against integer,
  points      integer
)
language sql
stable
-- ⚠️ SECURITY DEFINER ОБЯЗАТЕЛЕН, И ЕГО ЗДЕСЬ ЗАБЫЛИ. Ниже в этом же файле
-- arena_result намеренно заперт: `revoke all ... from anon, authenticated`.
-- Грант на ВЫЗОВ функции есть, а сама она шла от имени вызывающего — то есть
-- лезла в запертую таблицу правами anon и падала:
--   42501 permission denied for table arena_result
-- Таблица лидеров арены не открывалась НИ РАЗУ, у всех. Соседняя
-- record_arena_result в этом же файле definer'ом объявлена, читающую пропустили.
--
-- Открывать таблицу грантом (как советует подсказка Postgres) НЕЛЬЗЯ: рядом
-- лежат players с личными данными. Правильный путь ровно этот — читать под
-- definer'ом и отдавать только сводку. Так сделаны и все прочие таблицы
-- лидеров проекта: prediction_leaderboard, fantasy_standings, league_table.
security definer
set search_path = public
as $$
  select
    r.telegram_id,
    -- Имя собирается здесь, потому что в `players` его одной колонкой нет:
    -- есть first_name/last_name/username, и склеивать их на клиенте значило бы
    -- завести второе место, где решается, как игрока зовут.
    coalesce(
      nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
      p.username
    ) as name,
    count(*)::integer,
    count(*) filter (where r.scored > r.conceded)::integer,
    count(*) filter (where r.scored = r.conceded)::integer,
    count(*) filter (where r.scored < r.conceded)::integer,
    coalesce(sum(r.scored), 0)::integer,
    coalesce(sum(r.conceded), 0)::integer,
    (count(*) filter (where r.scored > r.conceded) * 3
     + count(*) filter (where r.scored = r.conceded))::integer as points
  from public.arena_result r
  -- `players.id` И ЕСТЬ telegram id — отдельной колонки нет.
  left join public.players p on p.id = r.telegram_id
  where r.confirmed
    and r.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 3650)))
  group by r.telegram_id, p.first_name, p.last_name, p.username
  order by points desc,
           (coalesce(sum(r.scored), 0) - coalesce(sum(r.conceded), 0)) desc,
           count(*) asc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

-- ---------------------------------------------------------------------------
-- Права.
--
-- ⚠️ Политика — не грант, и грант проверяется ПЕРВЫМ (см. current_squads.sql,
-- где отсутствие гранта уронило всю колоду). Здесь оба гейта закрыты
-- намеренно: писать в таблицу напрямую нельзя никому, потому что вся защита
-- от выдуманных побед живёт в функции, а не в политике.
-- ---------------------------------------------------------------------------
alter table public.arena_result enable row level security;
revoke all on public.arena_result from anon, authenticated;
grant select, insert, update on public.arena_result to service_role;

revoke all on function public.record_arena_result(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_arena_result(text, text, integer, integer)
  to anon, authenticated, service_role;
grant execute on function public.arena_leaderboard(integer, integer)
  to anon, authenticated, service_role;
