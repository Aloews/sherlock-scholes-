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
}

export interface GoalClip {
  video_id: string;
  title: string;
  channel: string;
  published_at: string;
  thumb_url: string | null;
}

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
 * Ролик выходных. То же, что GoalClip, плюс то, чего у дневного нет: настоящие
 * просмотры и признак «похоже на гол».
 */
export interface RankedClip extends GoalClip {
  views: number;
  likes: number;
  /** Разбор заголовка, а не факт. Экран честно помечает остальное как момент. */
  is_goal: boolean;
}

/**
 * Ролик выходных — то же плюс границы окна, которые показывает подпись.
 *
 * Отдельный тип от RankedClip, а не «то же с необязательными полями»:
 * недельный список этих границ не возвращает вовсе, и опциональность здесь
 * означала бы «иногда есть», хотя на деле — «есть ровно у одного из двух».
 */
export interface WeekendGoal extends RankedClip {
  weekend_start: string;
  weekend_end: string;
}

/**
 * Лучшие голы последних ЗАВЕРШИВШИХСЯ выходных.
 *
 * Порядок задаёт сервер: сначала голы, внутри — по просмотрам. Клиент его не
 * пересортировывает, иначе «лучшее» стало бы значить разное в двух местах.
 */
export async function fetchWeekendGoals(limit = 12): Promise<WeekendGoal[]> {
  const { data, error } = await supabase.rpc('digest_weekend_goals', { p_limit: limit });
  if (error) {
    console.error('[digest] digest_weekend_goals failed:', error.code, error.message);
    return [];
  }
  return (data as WeekendGoal[]) ?? [];
}

/**
 * Лучшее за неделю МИМО ВЫХОДНЫХ.
 *
 * РАЗДЕЛ СУЩЕСТВУЕТ ИЗ-ЗА ДЫРЫ, В КОТОРУЮ ПРОВАЛИЛСЯ СУПЕРКУБОК. Ролик UEFA
 * от пятницы был скачан вовремя и лежал в базе, но показать его было негде:
 * в блок выходных (8–10 августа) он не попадает, а из суточного выпал через
 * 24 часа. Так же исчезало всё, что играется с понедельника по пятницу —
 * Лига чемпионов, кубки, отборочные.
 *
 * Границы вычитаются те же, что у блока выходных, поэтому один ролик не может
 * оказаться в обоих списках.
 */
export async function fetchWeekGoals(limit = 12): Promise<RankedClip[]> {
  const { data, error } = await supabase.rpc('digest_week_goals', { p_limit: limit });
  if (error) {
    console.error('[digest] digest_week_goals failed:', error.code, error.message);
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
