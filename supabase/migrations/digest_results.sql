-- ===========================================================================
-- digest_results — СЧЁТ для «краткой сути».
--
-- Владелец: «результаты громких команд в лиге чемпионов выводи в краткую суть».
--
-- ⚠️ РАНЬШЕ СВОДКА НЕ МОГЛА ЭТОГО В ПРИНЦИПЕ, И ЭТО НЕ БЫЛО ОШИБКОЙ. Модель
-- в digest-summary видит ТОЛЬКО заголовки лент, а системная подсказка прямо
-- запрещает ей дописывать «счёт, суммы, даты, имена», которых в заголовках
-- нет: читатель проверить не может и просто поверит. То есть счёт в сводке
-- взяться было неоткуда, кроме выдумки, — и подсказка правильно её запрещала.
--
-- Поэтому счёт подаётся ОТДЕЛЬНЫМ БЛОКОМ НАШИХ ДАННЫХ, а не выуживается из
-- чужих заголовков. Это меняет статус: <headlines> — чужой текст, который
-- пересказывают осторожно, <results> — наша таблица, которую можно называть
-- точно.
--
-- ⚠️ ПОРЯДОК: СНАЧАЛА УЕФА, ПОТОМ ИЗВЕСТНОСТЬ, И ПО БОЛЬШЕМУ ИЗ ДВУХ КЛУБОВ.
-- По сумме двух не годится: у «Атлетико Мадрид» в колоде НЕТ карточки вовсе,
-- значит fame = 0, и «Ливерпуль — Атлетико» провалился бы ниже «Борнмут —
-- Эвертон» (95+95). Один громкий клуб — уже сюжет, поэтому greatest.
--
-- fame, а не club_rating.level: замерено на боевых данных, level лежит в
-- 93–100 у всех и «Ковентри» обгоняет «Манчестер Сити». fame разносит.
--
-- Приоритет УЕФА проверен на настоящих сыгранных матчах: за окно в 336 часов
-- вся шестёрка — квалификация Лиги чемпионов, выше АПЛ и Ла Лиги.
-- ===========================================================================
create or replace function public.digest_results(
  p_hours int default 48,
  p_limit int default 6
)
returns table (
  sport_key   text,
  home_team   text,
  away_team   text,
  home_score  smallint,
  away_score  smallint,
  played_at   timestamptz,
  is_uefa     boolean
)
language sql stable security definer set search_path = public as $$
  select f.sport_key, f.home_team, f.away_team, f.home_score, f.away_score,
         f.commence_at,
         f.sport_key like 'soccer_uefa%'
    from fixtures f
    left join cards hc on hc.id = f.home_card_id
    left join cards ac on ac.id = f.away_card_id
   where f.completed
     and f.home_score is not null
     and f.away_score is not null
     and f.commence_at > now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 48), 336)))
     and f.commence_at <= now()
   order by (f.sport_key like 'soccer_uefa%') desc,
            greatest(coalesce(hc.fame, 0), coalesce(ac.fame, 0)) desc,
            coalesce(hc.fame, 0) + coalesce(ac.fame, 0) desc,
            f.commence_at desc
   limit greatest(1, least(coalesce(p_limit, 6), 20));
$$;

-- Грант перечислен явно: политика без гранта роняла этот проект дважды.
grant execute on function public.digest_results(int, int)
  to anon, authenticated, service_role;
