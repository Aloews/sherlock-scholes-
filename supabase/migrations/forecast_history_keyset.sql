-- История прогнозов вырастет до десятков тысяч строк: нужен курсор, не limit
-- ===========================================================================
--
-- Владелец: «История предсказаний по мере матча будет очень длинной, в 1000
-- или даже 10 000 матчей, учти это». Каждый сыгранный матч добавляет по строке
-- НА ПРОГНОЗИСТА, то есть тысяча матчей — это три тысячи строк.
--
-- Было: `forecast_history(p_model, p_limit)` — только первые N, дальше никак.
-- Экран показывал сорок строк и молча делал вид, что это вся история.
--
-- ⚠️ КЛЮЧОМ, А НЕ СМЕЩЕНИЕМ. `offset N` заставляет базу прочитать и выбросить
-- N строк: десятая страница дешёвая, трёхсотая — нет, и тормозит она ровно
-- тогда, когда истории накопилось много. Курсор по (commence_at, fixture_id)
-- стоит одинаково на любой глубине. Этот проект уже наступал на смещение в
-- постраничном чтении PostgREST — там оно закреплено тестом
-- `select_pages_by_key_not_offset`.
--
-- ⚠️ ВТОРОЙ КЛЮЧ — НЕСУЩИЙ, А НЕ ПЕРЕСТРАХОВКА, И ЭТО ИЗМЕРЕНО. Время матча
-- НЕ уникально: у одного тура оно совпадает до секунды. Замер по боевым данным
-- 20.09.2026, модель «муха»:
--
--     строк                                   992
--     уникальных (commence_at, fixture_id)    992   ← курсор корректен
--     уникальных commence_at                   80
--     матчей с одной отметкой времени     до   95
--
-- То есть страница в сорок строк целиком помещается ВНУТРЬ группы из
-- девяноста пяти одновременных матчей. Курсор по одному `commence_at` на
-- такой группе либо зациклится (условие `<` не сдвинется), либо перескочит её
-- остаток — и пропадут ровно матчи главного тура, которые смотрят чаще всего.
--
-- `forecast_history_count` вынесен отдельной функцией: счёт нужен один раз на
-- открытие экрана, а страницы листаются много раз, и тащить его с каждой было
-- бы расточительно.

create index if not exists forecast_pick_history_idx
  on public.forecast_pick (model, commence_at desc, fixture_id desc)
  where correct is not null;

drop function if exists public.forecast_history(text, integer);

create or replace function public.forecast_history(
  p_model text default null,
  p_limit integer default 40,
  p_before_at timestamptz default null,
  p_before_id text default null)
returns table(fixture_id text, commence_at timestamptz, home_team text,
              away_team text, model text, pick text, confidence numeric,
              actual text, correct boolean, actual_total numeric,
              exp_total numeric, dopamine boolean, backfilled boolean)
language plpgsql stable security definer set search_path to 'public'
set statement_timeout to '4s'
as $function$
begin
  perform require_pro();
  return query
    select p.fixture_id, p.commence_at, p.home_team, p.away_team, p.model,
           p.pick, p.confidence, p.actual, p.correct, p.actual_total,
           p.exp_total, p.dopamine_at is not null, p.backfilled
      from forecast_pick p
     where p.correct is not null
       and (p_model is null or p.model = p_model)
       -- Оба поля курсора или ни одного: половина курсора молча вернула бы
       -- первую страницу, и список листался бы по кругу.
       and (p_before_at is null or p_before_id is null
            or (p.commence_at, p.fixture_id) < (p_before_at, p_before_id))
     order by p.commence_at desc, p.fixture_id desc
     limit greatest(1, least(coalesce(p_limit, 40), 200));
end;
$function$;

revoke all on function public.forecast_history(text, integer, timestamptz, text)
  from public;
grant execute on function public.forecast_history(text, integer, timestamptz, text)
  to anon, authenticated, service_role;

create or replace function public.forecast_history_count(p_model text default null)
returns integer
language plpgsql stable security definer set search_path to 'public'
set statement_timeout to '4s'
as $function$
declare n integer;
begin
  perform require_pro();
  select count(*) into n from forecast_pick p
   where p.correct is not null and (p_model is null or p.model = p_model);
  return n;
end;
$function$;

revoke all on function public.forecast_history_count(text) from public;
grant execute on function public.forecast_history_count(text)
  to anon, authenticated, service_role;
