// Новости и видео ПРО ЭТОГО ИГРОКА — на досье карточки.
//
// Схема и обоснование — supabase/migrations/player_news_and_clips.sql. Связка
// с дайджестом идёт по фамилии, той же токенизацией, что клеит темы через
// алфавиты (`digest_tokens`), а не по отдельному полю: его не было и заводить
// не пришлось.
//
// ⚠️ ОДНОФАМИЛЬЦЫ — ИЗВЕСТНЫЙ ПРЕДЕЛ, задокументированный в миграции. Экран
// не пытается его снимать.

import { supabase } from '@/shared/lib/supabase';

export interface PlayerNewsItem {
  title: string;
  url: string;
  source: string;
  lang: string;
  published_at: string;
}

export interface PlayerClip {
  video_id: string;
  title: string;
  channel: string;
  published_at: string;
  thumb_url: string | null;
}

/**
 * Пусто — значит про игрока не писали трое суток (`news_items` столько и
 * живёт), а не «не нашли». Разбираться в этом различии здесь незачем: секция
 * на досье в обоих случаях просто не появляется.
 */
export async function fetchPlayerNews(cardId: string, limit = 8): Promise<PlayerNewsItem[]> {
  const { data, error } = await supabase.rpc('player_news', { p_card_id: cardId, p_limit: limit });
  if (error) {
    console.error('[player-media] player_news failed:', error.code, error.message);
    return [];
  }
  return (data as PlayerNewsItem[]) ?? [];
}

export async function fetchPlayerClips(cardId: string, limit = 6): Promise<PlayerClip[]> {
  const { data, error } = await supabase.rpc('player_clips', { p_card_id: cardId, p_limit: limit });
  if (error) {
    console.error('[player-media] player_clips failed:', error.code, error.message);
    return [];
  }
  return (data as PlayerClip[]) ?? [];
}
