// Рейтинг футболистов — клиентская половина player_match_stats.sql.
//
// ЧТО ЗДЕСЬ СЧИТАЕТСЯ И ЧЕГО ЗДЕСЬ НЕТ. Очки — `голы*4 + пасы*3`, ровно та же
// шкала, по которой начисляет фэнтези. Считает их Postgres, а не этот файл:
// два места, считающих одно и то же, рано или поздно разойдутся, и разошлись
// бы незаметно — обе цифры выглядели бы правдоподобно.
//
// СВЕЖЕСТЬ ЗАПРАШИВАЕТСЯ ОТДЕЛЬНО И ЭТО НЕ ЛИШНИЙ ВЫЗОВ. Пустая неделя —
// настоящий ответ во время паузы на сборные, и она же — то, как выглядит
// умерший конвейер. Без даты сбора экран сказал бы «за неделю никто не
// забил» в обоих случаях, а это утверждение про футбол, а не про загрузку
// (docs/MAP.md §8а: опасна та пустота, которая ЧТО-ТО УТВЕРЖДАЕТ).
//
// Чистые функции про свежесть лежат в `freshness.ts` — иначе их нельзя было бы
// проверить тестом, не подняв всё окружение.

import { supabase } from '@/shared/lib/supabase';
import { fromPostgrest, type LoadState } from '@/shared/lib/loadState';
import type { RatingWindow } from './freshness';
import type { CollectionFilter } from '@/features/collection/collectionApi';

export interface RatingRow {
  card_id: string;
  name: string;
  name_en: string | null;
  photo_url: string | null;
  country: string | null;
  /** Текущий клуб, если он известен. Приходит из `club_squad`, а не из
   *  `card_current_club`: там он лежит С КЛЮЧОМ, то есть по нему можно
   *  перейти на экран команды, а не только прочитать. Состав собирается из
   *  свидетельств и бывает устаревшим, поэтому подписан «на дату». */
  club: string | null;
  /** Ключ клуба для ссылки. null — клуба не знаем. */
  club_key: string | null;
  /** Уровень игрока — ТО ЖЕ ЧИСЛО, что показывает коллекция. Заведено
   *  потому, что рейтинг и тир расходились: игрок мог быть первым в рейтинге
   *  и оставаться common в коллекции. См. player_level в football_clubs.sql. */
  level: number | null;
  /** 'fame' — матчей мало, уровень построен только на известности;
   *  'fame+form' — есть и то и другое. Экран обязан различать: в первом
   *  случае число не про игру. */
  basis: string | null;
  matches: number;
  /** null — минуты неизвестны. ESPN их не отдаёт вовсе: его subbedIn/subbedOut
   *  булевы, то есть «вышел» есть, а «когда» нет. Ноль на этом месте был бы
   *  ложью с последствиями — рейтинг ломает ничью по «меньше минут при той же
   *  отдаче». */
  minutes: number | null;
  goals: number;
  assists: number;
  points: number;
}

export interface RatingFreshness {
  /** Самый ранний матч, который у нас вообще есть. Годовое окно наполняется
   *  постепенно: страница sports.ru отдаёт ОДИН сезон, переключатель сезонов
   *  ходит в закрытый robots'ом /ajax/, поэтому первый сбор дотягивается
   *  только до начала текущего сезона. Экран обязан назвать эту дату, иначе
   *  «за год» пообещает год, которого в таблице нет. */
  first_match: string | null;
  last_match: string | null;
  collected_at: string | null;
  players: number;
  matches: number;
}

export const RATING_LIMIT = 50;

/**
 * Рейтинг за окно в днях.
 *
 * Порядок задаёт SQL (очки, потом голы, потом меньше минут) — сортировать ещё
 * раз на клиенте значит завести второе место, где решается порядок.
 */
export async function fetchRatings(
  days: RatingWindow,
  limit = RATING_LIMIT,
  filter?: { clubKey?: string | null; league?: string | null; country?: string | null },
): Promise<LoadState<RatingRow[]>> {
  // ⚠️ ОТБОР УХОДИТ В БАЗУ. На клиенте он резал бы уже готовую полусотню:
  // «Барселона» в рейтинге дала бы двух игроков вместо шести, потому что
  // остальные не попали в исходный лимит.
  const res = await supabase.rpc('player_ratings', {
    p_days: days,
    p_limit: limit,
    p_club_key: filter?.clubKey || null,
    p_league: filter?.league || null,
    p_country: filter?.country || null,
  });
  return fromPostgrest<RatingRow[]>(res, `player_ratings(${days})`);
}

/** Когда конвейер последний раз что-то принёс и что у нас вообще есть. */
export async function fetchFreshness(): Promise<LoadState<RatingFreshness | null>> {
  const res = await supabase.rpc('player_stats_freshness');
  const state = fromPostgrest<RatingFreshness[]>(res, 'player_stats_freshness');
  if (state.status !== 'ok') return state;
  return { status: 'ok', data: state.data[0] ?? null };
}

export interface CollectedTotals {
  tournament: string;
  matches: number;
  /** null — минуты не знает ни один источник; см. RatingRow.minutes. */
  minutes: number | null;
  goals: number;
  assists: number;
  yellow: number;
  red: number;
  first_match: string;
  last_match: string;
}

/**
 * Свёртка собранных матчей по турнирам — для досье карточки.
 *
 * НОВОГО ИСТОЧНИКА ПОД ЭТО НЕ НУЖНО. Сезонные итоги выводятся из того, что
 * уже лежит в `player_match_stats`: мелкое зерно всегда сворачивается в
 * крупное. Обратное неверно — именно поэтому окно в 7 дней потребовало
 * матчей, а не сезонных таблиц.
 */
export async function fetchCollectedTotals(
  cardId: string,
): Promise<LoadState<CollectedTotals[]>> {
  const res = await supabase.rpc('player_collected_totals', { p_card_id: cardId });
  return fromPostgrest<CollectedTotals[]>(res, 'player_collected_totals');
}

/** Клубная карьера из статистики Transfermarkt: один клуб — одна строка. */
export interface ClubCareerRow {
  club_id: string;
  club_name: string;
  season_from: number;
  season_to: number;
  apps: number;
  goals: number;
  assists: number;
  minutes: number;
}

/**
 * Клубная карьера по сезонам, от последнего клуба к первому.
 *
 * ⚠️ ЭТО НЕ ТО ЖЕ, ЧТО `card.career_stats`, и подменять одно другим нельзя.
 * `career_stats` — инфобокс Википедии: четыре верхних клуба ПО МАТЧАМ, и у
 * Классена в них не попал «ВСГ Тироль», где он отыграл лучший свой сезон.
 * Здесь — все клубы, сложенные из сезонных строк источника, а сборные из
 * подсчёта исключены по флагу источника, а не по имени.
 */
export async function fetchClubCareer(
  cardId: string,
): Promise<LoadState<ClubCareerRow[]>> {
  const res = await supabase.rpc('player_club_career', { p_card_id: cardId });
  return fromPostgrest<ClubCareerRow[]>(res, 'player_club_career');
}

/** Что изменилось у показателя за окно. `was`/`growth` пусты, если считать не из чего. */
export interface MetricChange {
  metric: string;
  was: number | null;
  now_value: number | null;
  delta: number | null;
  growth: number | null;
  changed_on: string;
}

/**
 * История изменений главных показателей карточки.
 *
 * ⚠️ ХРАНЯТСЯ ИЗМЕНЕНИЯ, А НЕ ЕЖЕНОЧНЫЕ КОПИИ, поэтому `changed_on` — день,
 * когда показатель стал таким, а НЕ «дата последнего замера». Читать его как
 * свежесть данных значит объявить устаревшим то, что просто не менялось.
 *
 * ⚠️ `now_value: null` — ЭТО ЗНАЧАЩЕЕ ЗНАЧЕНИЕ, а не ошибка загрузки: числа у
 * показателя нет вовсе. У 4794 действующих игроков нет стоимости, и история
 * говорит об этом прямо, вместо того чтобы молчать.
 */
export async function fetchMetricChanges(
  cardId: string,
  days = 90,
): Promise<LoadState<MetricChange[]>> {
  const res = await supabase.rpc('card_metric_changes', {
    p_card_id: cardId, p_days: days,
  });
  return fromPostgrest<MetricChange[]>(res, 'card_metric_changes');
}

/**
 * По какому показателю строить общий список игроков.
 *
 * ⚠️ ЗНАЧЕНИЯ СОВПАДАЮТ С `p_sort` В SQL И ДОЛЖНЫ СОВПАДАТЬ ДАЛЬШЕ. Ветка
 * `case` в `player_index` — единственное место, где решается, что считать; тут
 * только имена. Разъедутся — экран молча покажет общий рейтинг под подписью
 * «по стоимости», и заметить это будет нечем.
 */
export const INDEX_SORTS = [
  'index', 'value', 'views', 'stats', 'goals', 'news', 'rating',
  // Пять показателей, добавленных по просьбе владельца «и другие новые, не
  // менее важные 5 шт.». Все считаются ночью и лежат колонками в
  // player_level: считать их в запросе списка значит делать это для всех
  // 25 509 карточек при каждом открытии экрана.
  'growth', 'caps', 'countries', 'cards', 'young',
] as const;
export type IndexSort = (typeof INDEX_SORTS)[number];

export interface PlayerIndexRow {
  card_id: string;
  name: string;
  name_en: string | null;
  photo_url: string | null;
  country: string | null;
  continent: string | null;
  club_key: string | null;
  club: string | null;
  league: string | null;
  /** Общий счёт по четырём опорам. */
  index_score: number | null;
  /** Сколько опор его сложили: 1..4. Четвёрка весомее одиночки. */
  parts: number | null;
  value_part: number | null;
  views_part: number | null;
  stats_part: number | null;
  news_part: number | null;
  /** Сырое число выбранного показателя: евро, просмотры, минуты. */
  sort_value: number | null;
  place: number;
}

/** Континенты колоды. Океании тут нет — её нет и в правиле, по которому
 *  континент проставляется: Австралия и Новая Зеландия сидят в «Прочих». */
export const CONTINENTS = [
  'europe', 'south_america', 'north_america', 'africa', 'asia',
] as const;
export type Continent = (typeof CONTINENTS)[number];

/** Отбор списка: клуб, лига, страна — как в коллекции, плюс континент. */
export interface IndexFilter extends CollectionFilter {
  continent?: Continent | null;
}

export const INDEX_LIMIT = 50;

/**
 * Общий рейтинг игроков и сортировки по каждой опоре, внутри лиги/страны/клуба.
 *
 * ⚠️ ОТБОР И ПОРЯДОК ДЕЛАЕТ SQL. На клиенте отбор резал бы готовую полусотню, а
 * при 25 509 карточках PostgREST и вовсе отдаёт не больше тысячи строк: «лучший
 * в лиге» получился бы лучшим из тех, кто попал в первую страницу.
 */
export async function fetchPlayerIndex(
  sort: IndexSort,
  filter?: IndexFilter,
  lang = 'ru',
  limit = INDEX_LIMIT,
  offset = 0,
): Promise<LoadState<PlayerIndexRow[]>> {
  const res = await supabase.rpc('player_index', {
    p_sort: sort,
    p_league: filter?.league || null,
    p_country: filter?.country || null,
    p_club_key: filter?.clubKey || null,
    p_lang: lang,
    p_limit: limit,
    p_offset: offset,
    p_continent: filter?.continent || null,
  });
  return fromPostgrest<PlayerIndexRow[]>(res, `player_index(${sort})`);
}

/**
 * Сколько игроков в срезе — чтобы «3-й из 540» было честным числом.
 *
 * ⚠️ ЭТО НЕ ДЛИНА СПИСКА НА ЭКРАНЕ. Экран показывает полсотни; знаменатель
 * обязан считать всех, иначе каждый список кончался бы «50-м из 50».
 */
export async function fetchPlayerIndexCount(
  sort: IndexSort,
  filter?: IndexFilter,
): Promise<LoadState<number>> {
  const res = await supabase.rpc('player_index_count', {
    p_sort: sort,
    p_league: filter?.league || null,
    p_country: filter?.country || null,
    p_club_key: filter?.clubKey || null,
    p_continent: filter?.continent || null,
  });
  return fromPostgrest<number>(res, `player_index_count(${sort})`);
}

/** Итоги карьеры одной строкой: клубы, сборная, лиги, страны. */
export interface CareerTotalsRow {
  club_apps: number;
  club_goals: number;
  club_assists: number;
  club_minutes: number;
  club_count: number;
  season_from: number | null;
  season_to: number | null;
  national_apps: number;
  national_goals: number;
  national_team: string | null;
  leagues: number;
  countries: number;
}

/**
 * Итоги карьеры игрока.
 *
 * ⚠️ `national_apps` — МАТЧИ ЗА ОДНУ КОМАНДУ, ту, что названа в
 * `national_team`, а не сумму по всем сборным. Сумма давала Криштиану Роналду
 * 259 матчей за Португалию: 246 за главную плюс юношеские и олимпийскую.
 */
export async function fetchCareerTotals(
  cardId: string,
): Promise<LoadState<CareerTotalsRow[]>> {
  const res = await supabase.rpc('player_career_totals', { p_card_id: cardId });
  return fromPostgrest<CareerTotalsRow[]>(res, 'player_career_totals');
}

/** Важный предстоящий матч: обе эмблемы, стоимость обоих составов. */
export interface TopFixture {
  fixture_id: string;
  commence_at: string;
  /** Ключ турнира из расписания: `soccer_uefa_champs_league` и т.п. */
  sport_key: string | null;
  /** Домашняя лига клуба-хозяина. Запасной вариант, если турнир не переведён. */
  league: string | null;
  home_key: string; home_name: string | null; home_crest: string | null;
  home_value: number | null; home_squad: number;
  away_key: string; away_name: string | null; away_crest: string | null;
  away_value: number | null; away_squad: number;
  /** Сумма стоимости обоих составов — то, чем матчи упорядочены. */
  importance: number;
  /** Сколько минут до начала. Считает БАЗА: часы телефона врут молча, и на
   *  устройстве с уехавшим временем «через полчаса» стало бы «через два часа».
   *  По нему `fixtureCountdown` решает, писать анонс, часы или дату. */
  minutes_to_start: number | null;
}

/**
 * Самые важные ближайшие матчи.
 *
 * ⚠️ ВАЖНОСТЬ — СУММА СТОИМОСТИ ДВУХ СОСТАВОВ, и это выбор, а не единственный
 * возможный: владелец просил считать основной метрикой стоимость. Проверка на
 * бою вывела наверх дерби «Манчестер Юнайтед» — «Манчестер Сити» (2158 млн €),
 * следом «Порту» — «Манчестер Сити» и «Наполи» — «Арсенал».
 *
 * ⚠️ ОТБОР И ПОРЯДОК ДЕЛАЕТ SQL. Расписание живёт целиком в базе, а PostgREST
 * отдаёт не больше тысячи строк.
 */
export async function fetchTopFixtures(
  lang = 'ru',
  limit = 3,
  days = 10,
): Promise<LoadState<TopFixture[]>> {
  const res = await supabase.rpc('top_fixtures', {
    p_lang: lang, p_limit: limit, p_days: days,
  });
  return fromPostgrest<TopFixture[]>(res, 'top_fixtures');
}

/** Карточка, у которой показатель резко пошёл вверх. */
export interface RisingCard {
  card_id: string;
  name: string;
  name_en: string | null;
  photo_url: string | null;
  club: string | null;
  club_key: string | null;
  /** Какой именно показатель вырос: market_value, pageviews, news_30d… */
  metric: string;
  was: number;
  now_value: number;
  /** Во сколько раз. 1.8 значит «в 1,8 раза». */
  growth: number;
  changed_on: string;
}

/**
 * Кто резко пошёл в гору.
 *
 * ⚠️ ПОКАЗАТЕЛЬ НАЗЫВАЕТСЯ. «Игрок вырос» без указания, в чём именно, —
 * бесполезная строка: подорожал, попал в новости и пробежал больше минут это
 * три разных события.
 *
 * ⚠️ РОСТ ОТ МАЛОГО ЧИСЛА ОТРЕЗАН В SQL порогами «было» у каждого показателя.
 * Одно упоминание против нуля — рост в бесконечность раз; без порогов верхушку
 * заняли бы неизвестные игроки с двумя просмотрами.
 */
export async function fetchRisingCards(
  days = 30,
  limit = 20,
  lang = 'ru',
  filter?: IndexFilter,
): Promise<LoadState<RisingCard[]>> {
  const res = await supabase.rpc('rising_cards', {
    p_days: days, p_limit: limit, p_lang: lang,
    p_league: filter?.league || null,
    p_country: filter?.country || null,
    p_continent: filter?.continent || null,
  });
  return fromPostgrest<RisingCard[]>(res, 'rising_cards');
}

/** Клуб, чей состав подорожал. Клуб растёт, когда растут его игроки. */
export interface RisingClub {
  club_key: string;
  club: string | null;
  crest_url: string | null;
  league: string | null;
  players: number;
  was: number;
  now_value: number;
  growth: number;
}

export async function fetchRisingClubs(
  days = 30, limit = 10, lang = 'ru',
): Promise<LoadState<RisingClub[]>> {
  const res = await supabase.rpc('rising_clubs', {
    p_days: days, p_limit: limit, p_lang: lang,
  });
  return fromPostgrest<RisingClub[]>(res, 'rising_clubs');
}
