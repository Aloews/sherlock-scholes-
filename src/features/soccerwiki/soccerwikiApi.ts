// Soccer Wiki: клиентская половина supabase/migrations/soccerwiki_detail.sql.
//
// ИСТОЧНИК НАЗЫВАЕТСЯ НА ЭКРАНЕ, И ЭТО НЕ ФОРМАЛЬНОСТЬ. en.soccerwiki.org —
// «for the fans, by the fans»: рейтинг там ставят читатели, а не редакция и не
// статистическая модель. Рядом на том же досье стоят стоимость Transfermarkt
// и просмотры Википедии, и без подписи все три числа читались бы как одна
// шкала «наша оценка игрока».
//
// ⚠️ РЕЙТИНГ SOCCER WIKI — НЕ `fame` И НЕ УРОВЕНЬ ИГРОКА. Уровень считает
// Postgres по собранной статистике матчей, известность — по просмотрам
// страницы. Смешивать их в одно число нельзя: они меряют разное и расходятся
// именно на интересных случаях (ветеран с высоким рейтингом и нулём матчей).

import { supabase } from '@/shared/lib/supabase';
import { fromPostgrest, type LoadState } from '@/shared/lib/loadState';

export interface SoccerWikiCard {
  pid: number;
  full_name: string | null;
  /** Коды позиций как их пишет источник: «D,DM,M(L)». */
  position: string | null;
  /** Роль словом: «Wingback», «Target Man», «Keeper». */
  position_desc: string | null;
  shirt_number: number | null;
  /** 1..99, оценка читателей источника. */
  rating: number | null;
  age: number | null;
  born_on: string | null;
  nation: string | null;
  nation_code: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  /** 'Left' | 'Right' | 'Both' — как их пишет источник. */
  foot: string | null;
  club_name: string | null;
  club_key: string | null;
}

export interface SoccerWikiSquadRow {
  pid: number;
  name: string;
  /** Карточка колоды, если игрок связан. null — в колоде его нет. */
  card_id: string | null;
  photo_url: string | null;
  shirt_number: number | null;
  position: string | null;
  age: number | null;
  rating: number | null;
  height_cm: number | null;
  foot: string | null;
}

export async function fetchSoccerWikiCard(
  cardId: string,
): Promise<LoadState<SoccerWikiCard[]>> {
  const res = await supabase.rpc('soccerwiki_card', { p_card_id: cardId });
  return fromPostgrest<SoccerWikiCard[]>(res, `soccerwiki_card(${cardId})`);
}

export async function fetchSoccerWikiSquad(
  clubKey: string,
  limit = 40,
): Promise<LoadState<SoccerWikiSquadRow[]>> {
  const res = await supabase.rpc('soccerwiki_squad', {
    p_club_key: clubKey, p_limit: limit,
  });
  return fromPostgrest<SoccerWikiSquadRow[]>(res, `soccerwiki_squad(${clubKey})`);
}
