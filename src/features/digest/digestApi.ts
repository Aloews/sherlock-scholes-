// Дайджест дня — клиентские обёртки.
//
// Схема и обоснование — supabase/migrations/football_digest.sql. Здесь только
// вызовы: обе таблицы наполняет конвейер по расписанию, клиент их не пишет и
// писать не может (грант на запись есть только у service_role).

import { supabase } from '@/shared/lib/supabase';
import { failed, fromPostgrest, ok, type LoadState } from '@/shared/lib/loadState';

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  /** Язык ЗАГОЛОВКА, не читателя: лента может быть чужой при пустой своей. */
  lang: string;
  published_at: string;
  image_url: string | null;
  /**
   * Сколько разных изданий вышло с этим сюжетом за сутки, включая это.
   *
   * Это и есть «громкость». Единица значит «больше никто» — и для языка с
   * одним источником она такой будет всегда, поэтому экран показывает метку
   * только начиная с двух.
   */
  loudness: number;
  /**
   * Краткая суть моделью, на языке заметки — или null, если писать было не
   * из чего (в RSS не было description) или провайдер ещё не настроен.
   * `digest_news()` уже возвращает `nullif(…, '')`, так что здесь либо
   * настоящий текст, либо ничего — «пробовали и не вышло» экрану не видно и
   * не должно быть видно, для читателя это то же самое, что «не пробовали».
   */
  summary_short: string | null;
}

export interface GoalClip {
  video_id: string;
  title: string;
  channel: string;
  published_at: string;
  thumb_url: string | null;
  /** Очищенный моделью заголовок — или null, см. summary_short выше. */
  title_generated: string | null;
}

/**
 * Ширина главного окна в сутках — ОДНА НА ОБА БЛОКА.
 *
 * Второй блок определён как «остаток недели МИМО главного окна», и границу он
 * берёт из этого же числа. Разъедутся два значения — и ролик окажется либо в
 * обоих списках сразу, либо ни в одном; и то и другое тихое.
 *
 * Три, а не два и не семь: на трёх сутках окно, открытое в понедельник,
 * накрывает и субботу с воскресеньем, и сам понедельник, а открытое в среду —
 * оба игровых дня Лиги чемпионов (вторник и среду).
 */
export const RECENT_DAYS = 3;

/**
 * Заголовки — С РАЗЛИЧЕНИЕМ «ПУСТО» И «СЛОМАЛОСЬ».
 *
 * Остальные обёртки в этом файле ещё возвращают пустой массив на ошибке, и это
 * ровно то, из-за чего три поломки подряд выглядели как отсутствие данных.
 * Лента переведена первой: она новая, на ней видно результат, и по ней можно
 * переносить остальные.
 */
export async function fetchNews(lang: string, limit = 30): Promise<LoadState<NewsItem[]>> {
  const res = await supabase.rpc('digest_news', { p_lang: lang, p_limit: limit });
  return fromPostgrest<NewsItem[]>(res, 'digest_news');
}

/**
 * Ранжированный ролик. То же, что GoalClip, плюс то, чего у дневного нет:
 * настоящие просмотры и признак «похоже на гол».
 */
export interface RankedClip extends GoalClip {
  views: number;
  likes: number;
  /** Разбор заголовка, а не факт. Экран честно помечает остальное как момент. */
  is_goal: boolean;
}

/**
 * Ролик главного блока — то же плюс границы окна, которые показывает подпись.
 *
 * Отдельный тип от RankedClip, а не «то же с необязательными полями»: второй
 * блок этих границ не возвращает вовсе, и опциональность здесь означала бы
 * «иногда есть», хотя на деле — «есть ровно у одного из двух».
 */
export interface RecentGoal extends RankedClip {
  window_start: string;
  window_end: string;
}

/**
 * Лучшее за последние RECENT_DAYS суток — главный блок экрана.
 *
 * РАНЬШЕ ЗДЕСЬ БЫЛИ ВЫХОДНЫЕ, и во вторник экран открывался субботой. Замер
 * 25.08.2026: окно выходных 22–24.08, а за прошедшие сутки лежало 83 ролика
 * понедельничных кубков и вторничной ЛЧ — вторым блоком, ниже.
 *
 * Порядок задаёт сервер и он НЕ по просмотрам: по одному лучшему ролику от
 * каждого дня окна, потом по второму. Просмотры — наполовину мера возраста,
 * поэтому чистая сортировка по ним прячет вчерашнее, а чистая сортировка по
 * свежести топит крупное (проверено: Реал за 3.6 млн исчезал из первой
 * восьмёрки). Обоснование целиком — digest_recent_window.sql.
 *
 * Клиент порядок не пересортировывает: иначе «лучшее» значило бы разное в
 * двух местах.
 *
 * 40, а не 12 — тот же потолок, что у самой функции. При 12 глобальный топ
 * отдавался одной-двум лигам целиком, а `leagues` на DigestScreen считается
 * ИЗ ЭТОГО ЖЕ списка, так что менее просматриваемая лига не получала даже
 * чипа фильтра, хотя её голы были в базе.
 */
export async function fetchRecentGoals(limit = 40, days = RECENT_DAYS): Promise<RecentGoal[]> {
  const { data, error } = await supabase.rpc('digest_recent_goals', {
    p_days: days,
    p_limit: limit,
  });
  if (error) {
    console.error('[digest] digest_recent_goals failed:', error.code, error.message);
    return [];
  }
  return (data as RecentGoal[]) ?? [];
}

/**
 * Остаток недели МИМО главного окна.
 *
 * РАЗДЕЛ СУЩЕСТВУЕТ ИЗ-ЗА ДЫРЫ, В КОТОРУЮ ПРОВАЛИЛСЯ СУПЕРКУБОК. Ролик UEFA
 * от пятницы был скачан вовремя и лежал в базе, но показать его было негде:
 * в блок выходных он не попадал, а из суточного выпал через 24 часа.
 *
 * ⚠️ Границу берёт ТУ ЖЕ, что главный блок, из общей константы RECENT_DAYS —
 * поэтому один ролик не может оказаться в обоих списках. Разъедутся два
 * значения, и ролик окажется либо в обоих, либо ни в одном.
 *
 * 40, а не 12 — см. комментарий у fetchRecentGoals выше, тот же барьер и та
 * же причина здесь.
 */
export async function fetchEarlierGoals(limit = 40, days = RECENT_DAYS): Promise<RankedClip[]> {
  const { data, error } = await supabase.rpc('digest_earlier_goals', {
    p_days: days,
    p_limit: limit,
  });
  if (error) {
    console.error('[digest] digest_earlier_goals failed:', error.code, error.message);
    return [];
  }
  return (data as RankedClip[]) ?? [];
}

/**
 * Эфир, который правообладатель открыл САМ.
 *
 * Схема и оба предиката — supabase/migrations/live_streams.sql. Здесь важно
 * одно: РАЗДЕЛ ПОЧТИ ВСЕГДА ПУСТ, и это норма, а не поломка. Матчи верхних
 * дивизионов проданы эксклюзивно и бесплатного эфира у лиги не имеют;
 * открывают резервные лиги, молодёжь, женский футбол. Экран поэтому не
 * показывает ни заголовка, ни «сейчас ничего не идёт» — раздела просто нет,
 * пока нечего показать.
 */
export interface LiveMatch {
  video_id: string;
  channel: string;
  title: string;
  /** Когда конвейер в последний раз видел эфир живым, не «начало матча». */
  seen_at: string;
}

export async function fetchLiveMatches(limit = 8): Promise<LiveMatch[]> {
  const { data, error } = await supabase.rpc('digest_live_matches', { p_limit: limit });
  if (error) {
    console.error('[digest] digest_live_matches failed:', error.code, error.message);
    return [];
  }
  return (data as LiveMatch[]) ?? [];
}

export async function fetchGoals(limit = 20): Promise<GoalClip[]> {
  const { data, error } = await supabase.rpc('digest_goals', { p_limit: limit });
  if (error) {
    console.error('[digest] digest_goals failed:', error.code, error.message);
    return [];
  }
  return (data as GoalClip[]) ?? [];
}

/**
 * Сводка по горячим темам — то, что пишет языковая модель.
 *
 * ⚠️ ЭТО ВЫЗОВ ПО КНОПКЕ, И ИМЕННО ПОЭТОМУ ОН ЗДЕСЬ, А НЕ В `useEffect`.
 * Генерация стоит денег, и частоту задаёт игрок. Расход при этом ограничен не
 * здесь, а на сервере: ключ кэша — отпечаток НАБОРА ТЕМ, так что все нажатия
 * на одних и тех же новостях отвечают одной записью. Клиенту остаётся не
 * дёргать функцию сам.
 *
 * Четыре исхода, и они РАЗНЫЕ на экране: готовый текст, «сегодня тихо» (тем
 * нет вовсе), «модель отказалась» и поломка. Свести их в «не получилось»
 * значило бы повторить ровно ту ошибку, ради которой заведён LoadState.
 */
export type DigestSummary =
  | { status: 'ok'; summary: string; cached: boolean; generatedAt: string }
  | { status: 'no_topics' }
  | { status: 'refused' };

export async function fetchDigestSummary(lang: string): Promise<LoadState<DigestSummary>> {
  const { data, error } = await supabase.functions.invoke('digest-summary', {
    body: { lang },
  });
  if (error) {
    console.error('[digest] digest-summary failed:', error.message);
    return failed('invoke_failed');
  }
  if (data?.status === 'no_topics') return ok({ status: 'no_topics' });
  if (data?.status === 'refused') return ok({ status: 'refused' });
  if (typeof data?.summary !== 'string' || !data.summary) return failed('malformed');

  return ok({
    status: 'ok',
    summary: data.summary as string,
    cached: Boolean(data.cached),
    generatedAt: (data.generated_at as string) ?? new Date().toISOString(),
  });
}
