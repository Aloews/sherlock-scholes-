import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { HOST_SOURCE, sourceKeyFromUrl } from '../src/shared/lib/provenance';

/**
 * ПРАВИЛО «ЧЕЙ ЭТОТ ФАЙЛ» ВЫПИСАНО ДВАЖДЫ — И ОБЕ ЗАПИСИ ОБЯЗАНЫ СОВПАДАТЬ.
 *
 * Оригинал живёт в SQL (`content_source_key` + строки `kind = 'host'` моста):
 * по нему считает ревизия прав и заполняется `cards.photo_source`. Копия
 * живёт в TypeScript: ею помечается КАЖДЫЙ показанный файл прямо в разметке,
 * и вывести её из базы нельзя — это стоило бы лишнего поля в каждом списке
 * карточек и запроса на каждый экран.
 *
 * ⚠️ РАЗЪЕХАВШЕЕСЯ ПРАВИЛО НЕ ПАДАЕТ НИГДЕ. Ревизия считает снимок
 * подписанным по одному правилу, разметка помечает его по другому — и обе
 * стороны «работают», просто говорят про разное. Ровно так же в этом проекте
 * разъезжался порог экспресса, выписанный в четырёх местах.
 *
 * ⚠️ И ОСОБЕННО — ПРАВИЛО ПРО upload.wikimedia.org. Один хост раздаёт и
 * Викисклад (свободные лицензии), и локальные загрузки языковых разделов, где
 * лежит несвободное. Потеряй копия этот разрез — и на экране появится метка
 * «Wikimedia Commons, CC» на файле, у которого такой лицензии нет.
 */

const SQL = readFileSync('supabase/migrations/content_rights.sql', 'utf8');

/** Строки моста вида ('host', 'хост', 'ключ') — только из блоков insert. */
function sqlHosts(): Record<string, string> {
  const out: Record<string, string> = {};
  const blocks = SQL.matchAll(
    /insert into public\.content_origin \(kind, token, source_key\) values([\s\S]*?)on conflict/g);
  for (const b of blocks) {
    for (const m of b[1].matchAll(/\('host',\s*'([^']+)',\s*'([a-z0-9_]+)'\)/g)) {
      out[m[1]] = m[2];
    }
  }
  return out;
}

describe('правило «чей файл»: SQL и разметка', () => {
  it('хосты в мосте и в коде — один в один', () => {
    const sql = sqlHosts();
    expect(Object.keys(sql).length, 'мост не разобран — тест надо переписать')
      .toBeGreaterThan(5);
    expect(HOST_SOURCE).toEqual(sql);
  });

  it('разрез upload.wikimedia.org есть В ОБЕИХ записях', () => {
    // В SQL — условием по пути внутри content_source_key.
    expect(SQL).toMatch(/upload\\\.wikimedia\\\.org\/wikipedia\/commons\//);
    expect(SQL).toContain("'wikipedia_local'");
    // В коде — тем же разрезом, и проверяется он поведением, а не текстом.
    expect(sourceKeyFromUrl(
      'https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg')).toBe('wikimedia_commons');
    expect(sourceKeyFromUrl(
      'https://upload.wikimedia.org/wikipedia/ru/thumb/b/b8/X.jpg')).toBe('wikipedia_local');
  });

  it('незнакомый хост остаётся БЕЗ метки, а не «прочим»', () => {
    // Отрицательный контроль: метка-заглушка спрятала бы чужое под своим.
    expect(sourceKeyFromUrl('https://example.invalid/x.jpg')).toBeNull();
    expect(sourceKeyFromUrl('not a url')).toBeNull();
    expect(sourceKeyFromUrl(null)).toBeNull();
    expect(sourceKeyFromUrl('')).toBeNull();
  });

  it('живые формы ссылок из базы разбираются', () => {
    expect(sourceKeyFromUrl(
      'https://commons.wikimedia.org/wiki/Special:FilePath/Helguera.jpg?width=256'))
      .toBe('wikimedia_commons');
    expect(sourceKeyFromUrl(
      'https://img.a.transfermarkt.technology/portrait/big/1-2.png')).toBe('transfermarkt');
    expect(sourceKeyFromUrl(
      'https://a.espncdn.com/i/teamlogos/soccer/500/83.png')).toBe('espn');
    expect(sourceKeyFromUrl('https://cdn.soccerwiki.org/images/player/1.png'))
      .toBe('soccerwiki');
  });
});
