-- Память экспрессов: история ставок — это экспрессы, а не одиночные матчи
-- ========================================================================
--
-- Владелец: «историю ставок публикуй именно экспрессов, а не одиночных
-- матчей, сделай память».
--
-- ⚠️ ДО ЭТОГО ЭКСПРЕСС НИГДЕ НЕ ЗАПИСЫВАЛСЯ. `admin_accumulator` собирала его
-- на лету и забывала: закрыл экран — нет ни того, что выбрали, ни того, чем
-- кончилось. Значит «стало ли лучше» проверить было НЕЧЕМ, и любое улучшение
-- пришлось бы принимать на слово. Память здесь не удобство, а условие
-- измеримости.
--
-- ⚠️ ХРАНИТСЯ ТО, ЧТО БЫЛО ИЗВЕСТНО В МОМЕНТ СОСТАВЛЕНИЯ. Котировка и
-- вероятность ноги кладутся числами: они меняются каждый час, и экспресс,
-- пересчитанный завтрашней котировкой, — это уже другой экспресс.
--
-- ⚠️ ЭКСПРЕСС ЗАКРЫВАЕТСЯ ТОЛЬКО ЦЕЛИКОМ. Соблазн закрыть его на первой
-- проигравшей ноге велик — исход уже ясен, — но тогда `legs_won` соврёт, а
-- именно по нему видно, промахнулись на одной ноге или на всех. Разница между
-- «три из четырёх» и «одна из четырёх» — это разница между «почти работает» и
-- «не работает».
--
-- ⚠️ ЧТЕНИЕ ТРЕБУЕТ ПАРОЛЯ, И ЭТО ЧИНИЛОСЬ ОТДЕЛЬНОЙ МИГРАЦИЕЙ. Первая
-- версия `accumulator_history` и `accumulator_scoreboard` принимала
-- `p_password` параметром и НЕ проверяла его: подпись с паролем,
-- `security definer`, грант анониму — выглядело защищённым, а внутри проверки
-- не было. В ногах лежат КОТИРОВКИ, внутренние по §4
-- docs/LIVE_FOOTBALL_HANDOFF.md — настолько, что у `fixture_odds` намеренно
-- нет ни политики, ни прав. Отдавать их анониму через боковую дверь нельзя.
-- Проверка теперь первой строкой, и обе функции стали plpgsql ради этого.
--
-- Проверено живьём 20.09.2026:
--   · неверный пароль отбит всеми тремя функциями (42501);
--   · контрольный экспресс на СЫГРАННЫХ матчах — одна нога заведомо верна,
--     одна заведомо нет — свёлся в legs_won = 1, won = false, закрыт;
--   · живой экспресс на несыгранных остался открытым, как и должен.

create table if not exists public.accumulator_ticket (
  id           bigint generated always as identity primary key,
  placed_at    timestamptz not null default now(),
  rule         text        not null,
  legs         smallint    not null check (legs between 2 and 12),
  pass_prob    numeric     not null,
  payout       numeric     not null,
  settled_at   timestamptz,
  won          boolean,
  legs_won     smallint
);

-- История будет длинной (владелец: «в 1000 или даже 10 000») и читается с
-- конца.
create index if not exists accumulator_ticket_recent_idx
  on public.accumulator_ticket (placed_at desc, id desc);
create index if not exists accumulator_ticket_rule_idx
  on public.accumulator_ticket (rule, placed_at desc);

create table if not exists public.accumulator_leg (
  ticket_id   bigint  not null references public.accumulator_ticket(id) on delete cascade,
  fixture_id  text    not null,
  pick        text    not null check (pick in ('H','D','A')),
  price       numeric not null,
  fair_prob   numeric not null,
  home_team   text    not null,
  away_team   text    not null,
  commence_at timestamptz not null,
  correct     boolean,
  primary key (ticket_id, fixture_id)
);

create index if not exists accumulator_leg_fixture_idx
  on public.accumulator_leg (fixture_id) where correct is null;

revoke all on public.accumulator_ticket from public, anon, authenticated;
revoke all on public.accumulator_leg    from public, anon, authenticated;

-- Тела функций применены миграциями `accumulator_memory_functions`,
-- `accumulator_history_and_scoreboard` и `accumulator_read_requires_password`:
--
--   record_accumulator(p_password, p_rule, p_legs jsonb) -> bigint
--       Вероятность и выплата считаются ЗДЕСЬ, из самих ног, а не принимаются
--       параметром: клиент, приславший своё число, однажды пришлёт неверное, и
--       расхождение между обещанным и произведением ног никто не заметит.
--
--   settle_accumulators() -> text            (сервисный ключ, ночной шаг)
--   accumulator_history(p_password, p_limit, p_before_at, p_before_id, p_rule)
--       Страницами ПО КЛЮЧУ, а не `offset`: на тысячах строк `offset`
--       заставляет базу построить и выбросить всё до нужной страницы — этот
--       проект уже получал 504 на шестой странице. Курсор — пара
--       (placed_at, id): одного времени мало, два экспресса могут лечь в одну
--       миллисекунду.
--   accumulator_scoreboard(p_password)
--       Незакрытые не считаются ни в числитель, ни в знаменатель: считать их
--       проигравшими значит показывать «стало хуже» сразу после того, как
--       составили новые.
