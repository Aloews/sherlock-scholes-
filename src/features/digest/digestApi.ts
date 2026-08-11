// Дайджест дня — клиентские обёртки.
//
// Схема и обоснование — supabase/migrations/football_digest.sql. Здесь только
// вызовы: обе таблицы наполняет конвейер по расписанию, клиент их не пишет и
// писать не может (грант на запись есть только у service_role).

import { supabase } from '@/shared/lib/supabase';

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

export async function fetchNews(lang: string, limit = 30): Promise<NewsItem[]> {
  const { data, error } = await supabase.rpc('digest_news', { p_lang: lang, p_limit: limit });
  if (error) {
    console.error('[digest] digest_news failed:', error.code, error.message);
    return [];
  }
  return (data as NewsItem[]) ?? [];
}

export async function fetchGoals(limit = 20): Promise<GoalClip[]> {
  const { data, error } = await supabase.rpc('digest_goals', { p_limit: limit });
  if (error) {
    console.error('[digest] digest_goals failed:', error.code, error.message);
    return [];
  }
  return (data as GoalClip[]) ?? [];
}
