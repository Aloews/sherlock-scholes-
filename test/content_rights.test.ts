import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * ПРОИСХОЖДЕНИЕ КОНТЕНТА: ИНВАРИАНТЫ, КОТОРЫЕ ЛОМАЮТСЯ МОЛЧА.
 *
 * ⚠️ ЭТО НЕ ПРОВЕРКА SQL-СИНТАКСИСА. Всё, что ниже, — способы сломать права
 * так, что ни один экран, ни один тест и ни один прогон не покраснеют:
 *
 *   1. повторное применение миграции затирает решение ВЛАДЕЛЬЦА о том, есть
 *      ли у нас право показывать источник;
 *   2. реестр источников закрывают, а внутреннюю ревизию открывают — и
 *      подпись исчезает с экрана, а список претензий становится публичным;
 *   3. в мост вписывают ключ, которого нет в реестре;
 *   4. в CHECK добавляют четвёртую форму подписи, а экран знает три —
 *      и новая форма молча рисуется как «подпись не требуется»;
 *   5. рвётся цепочка «хост Викисклада → источник → подпись у каждого файла»,
 *      и 7 тысяч снимков перестают требовать автора.
 */

const SQL = readFileSync('supabase/migrations/content_rights.sql', 'utf8');
const SCREEN = readFileSync('src/screens/SourcesScreen.tsx', 'utf8');

/** Тело `on conflict (key) do update set … ;` у реестра. */
function upsertBody(): string {
  const m = /on conflict \(key\) do update set([\s\S]*?);/.exec(SQL);
  expect(m, 'в миграции больше нет upsert реестра — тест надо переписать').not.toBeNull();
  return m![1];
}

/** Ключи реестра из VALUES. */
function sourceKeys(): string[] {
  const block = SQL.slice(SQL.indexOf('insert into public.content_source'),
                          SQL.indexOf('on conflict (key)'));
  return [...block.matchAll(/^\s{2}\('([a-z0-9_]+)',/gm)].map((m) => m[1]);
}

/**
 * Строки моста: [kind, token, source_key].
 *
 * ⚠️ БЕРЁМ ТОЛЬКО ИЗ БЛОКОВ `insert … values`. Первая версия искала по всему
 * файлу и «нашла» строку в CHECK-ограничении `kind in ('label','host',
 * 'column')` — тройку, которая тройкой не является. Тест падал на здоровой
 * миграции, то есть врал ровно так же, как соврал бы пропуск.
 */
function originRows(): [string, string, string][] {
  const out: [string, string, string][] = [];
  const blocks = SQL.matchAll(
    /insert into public\.content_origin \(kind, token, source_key\) values([\s\S]*?)on conflict/g);
  for (const b of blocks) {
    for (const m of b[1].matchAll(/\('(label|host|column)',\s*'([^']+)',\s*'([a-z0-9_]+)'\)/g)) {
      out.push([m[1], m[2], m[3]]);
    }
  }
  expect(out.length, 'блоки моста не разобраны — тест надо переписать').toBeGreaterThan(20);
  return out;
}

describe('реестр источников', () => {
  it('повторное применение НЕ затирает решение человека', () => {
    // ⚠️ САМАЯ ТИХАЯ ИЗ ВОЗМОЖНЫХ ПОЛОМОК. `license_ok` отвечает на вопрос
    // «есть ли у нас право это показывать», и ставит его владелец, а не
    // скрипт. Допиши кто-нибудь `license_ok = excluded.license_ok` в upsert —
    // и следующее применение миграции вернёт МОИ умолчания поверх его
    // решения. Ни одного признака на экране при этом не появится.
    const body = upsertBody();
    expect(body, 'license_ok затирается при повторном применении')
      .not.toMatch(/license_ok\s*=/);
    expect(body, 'note затирается при повторном применении').not.toMatch(/\bnote\s*=/);
    // И контроль обратного: upsert вообще что-то обновляет, иначе тест выше
    // проходил бы на пустом месте.
    expect(body).toMatch(/license\s*=\s*excluded\.license/);
  });

  it('реестр ОТКРЫТ игроку, а ревизия — ЗАКРЫТА', () => {
    // Две противоположные обязанности, и перепутать их ничего не мешает.
    // Закрытый реестр = подписи нет ни у кого (условие CC BY-SA не
    // выполнено). Открытая ревизия = публичный ответ «столько-то записей
    // показывается без разрешения».
    expect(SQL).toMatch(/grant select on public\.content_source[^;]*to anon/);
    for (const fn of ['content_rights_audit\\(boolean\\)',
                      'content_rights_gaps\\(\\)',
                      'content_rights_unresolved\\(\\)']) {
      expect(SQL, `${fn} не отозвана у anon`)
        .toMatch(new RegExp(`revoke all on function public\\.${fn}[^;]*anon`));
      expect(SQL, `${fn} выдана анониму — это список претензий наружу, да ещё и шесть секунд CPU`)
        .not.toMatch(new RegExp(`grant execute on function public\\.${fn}[^;]*anon`));
    }
    // А подпись под снимком игрок читать обязан — иначе лицензия не выполнена.
    expect(SQL).toMatch(/grant execute on function public\.media_credit_for\(text\[\]\)[^;]*anon/);
  });

  it('каждый ключ в мосте заведён в реестре', () => {
    const known = new Set(sourceKeys());
    expect(known.size).toBeGreaterThan(5);
    for (const [kind, token, key] of originRows()) {
      expect(known.has(key), `${kind}:${token} ссылается на несуществующий ${key}`).toBe(true);
    }
  });
});

describe('форма подписи', () => {
  it('экран знает ВСЕ формы, которые разрешает база', () => {
    // ⚠️ ЧЕТВЁРТАЯ ФОРМА МОЛЧА СТАНЕТ «НЕ ТРЕБУЕТСЯ». В SourcesScreen выбор
    // написан цепочкой: per_record → source → иначе none. Добавь в CHECK
    // 'per_use' — и он нарисуется как «подпись не требуется», то есть экран
    // соврёт про обязанность.
    const m = /attribution\s+text not null\s*\n?\s*check \(attribution in \(([^)]*)\)\)/.exec(SQL);
    expect(m, 'CHECK формы подписи не найден — тест надо переписать').not.toBeNull();
    const forms = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(forms.length).toBeGreaterThanOrEqual(3);
    for (const f of forms) {
      if (f === 'none') continue;   // 'none' — это и есть ветка «иначе»
      expect(SCREEN, `экран не знает формы «${f}»`).toContain(`'${f}'`);
    }
  });
});

describe('цепочка подписи к снимку', () => {
  it('хост Викисклада ведёт к источнику, который требует автора у КАЖДОГО файла', () => {
    // Цепочка из трёх звеньев, и рвётся любое: хост → ключ → форма подписи.
    // Порвётся — и 7 тысяч снимков перестанут считаться неподписанными,
    // оставаясь неподписанными на экране.
    const host = originRows().find(([k, t]) => k === 'host' && t === 'commons.wikimedia.org');
    expect(host, 'commons.wikimedia.org выпал из моста').toBeDefined();
    const key = host![2];

    const row = new RegExp(`\\('${key}',[\\s\\S]*?\\),\\n\\n`, 'm').exec(
      SQL.slice(SQL.indexOf('insert into public.content_source')));
    expect(row, `в реестре нет строки ${key}`).not.toBeNull();
    expect(row![0], `${key} больше не требует подписи у каждого файла`)
      .toContain("'per_record'");
  });

  it('подпись хранится по ССЫЛКЕ, а не в колонке карточки', () => {
    // Один файл лежит в трёх таблицах. Подпись в колонке `cards` означала бы,
    // что две копии на экране остаются без автора навсегда — ревизия так и
    // считала, пока ключом не стала ссылка.
    expect(SQL).toMatch(/create table if not exists public\.media_credit \(\s*\n[\s\S]*?url\s+text primary key/);
    expect(SQL, 'автор снова переехал в колонку карточки')
      .not.toMatch(/alter table public\.cards[\s\S]{0,400}photo_author/);
  });
});
