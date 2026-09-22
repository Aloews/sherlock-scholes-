import { supabase } from '@/shared/lib/supabase';
import { fromPostgrest, type LoadState } from '@/shared/lib/loadState';

/**
 * ОТКУДА ВЗЯТ КОНТЕНТ И НА КАКИХ УСЛОВИЯХ — сторона экрана.
 *
 * ⚠️ ЭТО НЕ ДЕКОРАЦИЯ, А УСЛОВИЕ ЛИЦЕНЗИИ. Снимки с Викисклада разрешено
 * показывать коммерчески ровно пока названы автор и лицензия. Замер
 * 22.09.2026: 7072 таких файла на экране и подпись у нуля из них. Подпись,
 * спрятанная в колонке базы, условия не выполняет: лицензия требует, чтобы
 * имя видел тот, кто смотрит снимок.
 *
 * Поэтому здесь два запроса и оба нужны:
 *
 *   `fetchMediaCredits`  — подпись к КОНКРЕТНОМУ файлу (автор, лицензия,
 *                          страница файла). Рядом со снимком.
 *   `fetchContentSources` — весь список источников с лицензиями. Один экран
 *                          на приложение, и он закрывает те лицензии, которым
 *                          довольно названного источника (тексты Википедии,
 *                          данные Викиданных).
 *
 * ⚠️ НАЗВАНИЯ ИСТОЧНИКОВ НЕ ПЕРЕВОДЯТСЯ и приходят из базы, а не из локалей.
 * «Wikimedia Commons» обязан остаться «Wikimedia Commons»: подпись должна
 * совпадать с тем, что требует лицензия, а не с языком интерфейса.
 */

export interface ContentSource {
  key: string;
  title: string;
  homepage: string | null;
  license: string;
  license_url: string | null;
  /** 'none' | 'source' | 'per_record' — см. шапку content_rights.sql. */
  attribution: string;
  terms_url: string | null;
}

export interface MediaCredit {
  url: string;
  /** NULL — у файла автора НЕ УКАЗАНО (общественное достояние), а не «не знаем». */
  author: string | null;
  license: string | null;
  license_url: string | null;
  credit_url: string | null;
}

export async function fetchContentSources(): Promise<LoadState<ContentSource[]>> {
  const res = await supabase
    .from('content_source')
    .select('key,title,homepage,license,license_url,attribution,terms_url')
    .order('title');
  return fromPostgrest<ContentSource[]>(
    { data: res.data as ContentSource[] | null, error: res.error }, 'content_source');
}

/**
 * Подписи к показанным сейчас файлам, одним запросом.
 *
 * ⚠️ ПУСТОЙ СПИСОК ССЫЛОК НЕ ХОДИТ В СЕТЬ. Досье открывается и у карточки без
 * фото; запрос «подпиши ничего» стоил бы столько же, сколько настоящий.
 */
export async function fetchMediaCredits(urls: string[]): Promise<LoadState<MediaCredit[]>> {
  const wanted = urls.filter(Boolean);
  if (wanted.length === 0) return { status: 'ok', data: [] };
  const res = await supabase.rpc('media_credit_for', { p_urls: wanted });
  return fromPostgrest<MediaCredit[]>(
    { data: res.data as MediaCredit[] | null, error: res.error }, 'media_credit_for');
}

/**
 * Ревизия прав для панели персонала: где условие не выполнено.
 *
 * ⚠️ ЗА ПАРОЛЕМ НАМЕРЕННО, И ЭТО НЕ ПЕРЕСТРАХОВКА. Ответ звучит как
 * «5335 снимков показываются без разрешения» — это утверждение ПРО НАС, а
 * не про контент. Игроку оно не нужно, а любому другому читателю даёт
 * готовый список претензий. Реестр источников (`fetchContentSources`)
 * открыт всем — он и есть подпись; ревизия закрыта.
 */
export interface RightsGap {
  /** 'источник не опознан' | 'нет подписи' | 'нет лицензии'. */
  problem: string;
  /** Таблица и колонка: `cards.photo_url`. */
  area: string;
  source_key: string;
  records: number;
}

export async function fetchRightsGaps(password: string): Promise<LoadState<RightsGap[]>> {
  const res = await supabase.rpc('admin_content_rights', { p_password: password });
  return fromPostgrest<RightsGap[]>(res, 'admin_content_rights');
}
