-- ============================================================================
-- Таблица лидеров прогнозов, но только среди друзей.
--
-- ЭТО НЕДОСТАЮЩЕЕ РЕБРО МЕЖДУ ДВУМЯ СИСТЕМАМИ, А НЕ НОВАЯ. `friends_with_
-- rating` (friends_and_rating.sql) уже сравнивает друзей по XP; prediction_
-- leaderboard.sql уже считает очки прогнозов — но только глобально, топ-20
-- среди всех. Своей команды тут никогда не было, а угадывать счёт при
-- зрителях менее пятнадцати друзей интереснее, чем тягаться с незнакомцами.
--
-- ВСЕГДА ПОЛНЫЙ СПИСОК ДРУЗЕЙ, А НЕ ТОЛЬКО ТЕ, КТО ПРЕДСКАЗЫВАЛ. Глобальная
-- prediction_leaderboard() специально исключает тех, кто ни разу не
-- прогнозировал (inner join на match_predictions) — там это Топ-20, вход в
-- него надо заслужить. Список друзей — не топ, а состав, тот же принцип, что
-- у friends_with_rating: друг с нулём прогнозов остаётся в списке с нулём,
-- а не пропадает из него, точно как там LEFT JOIN + coalesce, а не inner.
--
-- СЕБЯ ВКЛЮЧАЕТ. Иначе игрок видел бы рейтинг друзей без себя внутри и не
-- мог сравнить место напрямую — та же причина, по которой my_prediction_
-- stats() в prediction_leaderboard.sql существует отдельно от таблицы: тут,
-- наоборот, само присутствие в одном списке и есть сравнение.
--
-- ФОРМА ВОЗВРАЩАЕТ ТОТ ЖЕ PredictorRow, ЧТО И ГЛОБАЛЬНАЯ. Один тип на
-- клиенте, один рендер строки — переключатель меняет только то, откуда
-- пришли строки, не то, как они рисуются.
-- ============================================================================

-- ⚠️ ФОРМА ОТВЕТА ОБЯЗАНА СОВПАДАТЬ С prediction_leaderboard. Клиент читает
-- обе функции ОДНИМ типом PredictorRow, и колонка, добавленная там и забытая
-- здесь, приезжает на экран как `undefined` — а `undefined !== null` истинно,
-- так что проверка «есть ли значение» пропускает её и рисует «undefined%».
-- Ломается при этом только вкладка «Друзья», то есть половина экрана.
--
-- DROP перед CREATE — меняется тип возврата, `create or replace` его менять не
-- умеет (42P13). Обе команды в одной транзакции.
drop function if exists public.friend_prediction_leaderboard(text, integer);

create or replace function public.friend_prediction_leaderboard(
  p_init_data text,
  p_limit     integer default 20
)
returns table (
  player_id    bigint,
  first_name   text,
  last_name    text,
  avatar_url   text,
  points       integer,
  settled      integer,
  exact        integer,
  outcomes     integer,
  outcome_rate integer
)
language plpgsql
stable
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
    select pl.id, pl.first_name, pl.last_name, pl.avatar_url,
           coalesce(sum(mp.points), 0)::int,
           count(mp.player_id)::int,
           count(*) filter (where mp.points = 5)::int,
           count(*) filter (where mp.points >= 2)::int,
           -- Знаменатель — count(mp.player_id), а НЕ count(*): соединение
           -- левое, и у друга без прогнозов count(*) даёт 1 при нуле строк.
           case when count(mp.player_id) >= 5
                then round(100.0 * count(*) filter (where mp.points >= 2)
                                 / count(mp.player_id))::int end
      from players pl
      left join match_predictions mp
             on mp.player_id = pl.id and mp.settled_at is not null
     where pl.id = v_me
        or exists (
             select 1 from friendships f
              where f.player_id = v_me and f.friend_id = pl.id
           )
     group by pl.id, pl.first_name, pl.last_name, pl.avatar_url
     order by coalesce(sum(mp.points), 0) desc,
              case when count(mp.player_id) >= 5
                   then round(100.0 * count(*) filter (where mp.points >= 2)
                                    / count(mp.player_id))
                   else -1 end desc,
              count(*) filter (where mp.points = 5) desc,
              pl.first_name
     limit greatest(coalesce(p_limit, 20), 1);
end;
$$;

revoke all on function public.friend_prediction_leaderboard(text, integer) from public;
grant execute on function public.friend_prediction_leaderboard(text, integer)
  to anon, authenticated, service_role;

comment on function public.friend_prediction_leaderboard(text, integer) is
  'Как prediction_leaderboard(), но только вызывающий и его друзья (все, '
  'даже без единого прогноза) — сравнение внутри своей компании, не топ.';
