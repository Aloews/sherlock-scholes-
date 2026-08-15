// Дайджест дня — клиентские обёртки.
//
// Схема и обоснование — supabase/migrations/football_digest.sql. Здесь только
// вызовы: обе таблицы наполняет конвейер по расписанию, клиент их не пишет и
// писать не может (грант на запись есть только у service_role).

import { supabase } from '@/shared/lib/supabase';
import { fromPostgrest, type LoadState } from '@/shared/lib/loadState';

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

export async function fetchGoals(limit = 20): Promise<GoalClip[]> {
  const { data, error } = await supabase.rpc('digest_goals', { p_limit: limit });
  if (error) {
    console.error('[digest] digest_goals failed:', error.code, error.message);
    return [];
  }
  return (data as GoalClip[]) ?? [];
}
