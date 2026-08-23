-- ============================================================================
-- История прогнозов — что предсказал, что было на самом деле.
--
-- ЧЕГО НЕ ХВАТАЛО. `my_predictions()` уже возвращала всё нужное по числам —
-- fixture_id, свой счёт, очки, `settled_at`, — но ни одного имени команды.
-- Единственный клиент, который её читает (`MatchesScreen`), сопоставляет
-- ответ с массивом `upcoming` ПО fixture_id — а туда попадают только матчи
-- ближайших дней. Прогноз недельной давности на сыгранный матч остаётся в
-- `match_predictions` навсегда, но как только его fixture выпадает из
-- «ближайших», сопоставлять его больше не с чем: имя команды показать
-- нечем. История прогнозов поэтому не «пока не строили», а физически не
-- могла существовать без второго источника.
--
-- ПОЧЕМУ JOIN НА СЕРВЕРЕ, А НЕ ВТОРОЙ ЗАПРОС НА КЛИЕНТЕ. `fixtures` не хранит
-- переводов имён команд — они английские везде, и подбирать их у клиента
-- нечем. Сервер уже знает fixture по id: `match_predictions.fixture_id`
-- ссылается на `fixtures.id` внешним ключом, join не может разойтись с
-- источником, потому что это тот же самый источник.
--
-- ЗАВЕРШЁННЫЙ СЧЁТ ПОКАЗЫВАЕТСЯ, ТОЛЬКО КОГДА fixtures.completed. Матч мог
-- уже начаться и даже кончиться по времени, но /scores стоит кредит и
-- вызывается по требованию (sports_awaiting_scores) — секунду счёта может не
-- быть ещё какое-то время. «Пусто» здесь не значит «0:0», это разные ответы,
-- и путать их для истории прогнозов хуже, чем для самого матча: человек
-- увидит на своём счету число, которого не было.
-- ============================================================================

create or replace function public.my_prediction_history(
  p_init_data text,
  p_limit     integer default 50
)
returns table (
  fixture_id   text,
  sport_key    text,
  home_team    text,
  away_team    text,
  commence_at  timestamptz,
  pred_home    smallint,
  pred_away    smallint,
  -- NULL значит «матч ещё не сыгран или счёт ещё не забрали», а не 0:0.
  actual_home  smallint,
  actual_away  smallint,
  points       integer,
  settled_at   timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me bigint := tg_validate_init_data(p_init_data);
begin
  if v_me is null then
    raise exception 'invalid init data' using errcode = '28000';
  end if;
  return query
    select p.fixture_id, f.sport_key, f.home_team, f.away_team, f.commence_at,
           p.home_score, p.away_score,
           case when f.completed then f.home_score end,
           case when f.completed then f.away_score end,
           p.points, p.settled_at
      from public.match_predictions p
      join public.fixtures f on f.id = p.fixture_id
     where p.player_id = v_me
     order by p.created_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke all on function public.my_prediction_history(text, integer) from public;
grant execute on function public.my_prediction_history(text, integer)
  to anon, authenticated, service_role;
