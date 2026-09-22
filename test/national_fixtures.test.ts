import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { KNOWN_SPORT_KEYS, leagueKey } from '../src/features/fixtures/leagues';
import ru from '../src/shared/i18n/locales/ru.json';
import en from '../src/shared/i18n/locales/en.json';
import es from '../src/shared/i18n/locales/es.json';
import pt from '../src/shared/i18n/locales/pt.json';
import fr from '../src/shared/i18n/locales/fr.json';
import ar from '../src/shared/i18n/locales/ar.json';
import ja from '../src/shared/i18n/locales/ja.json';
import ko from '../src/shared/i18n/locales/ko.json';
import zh from '../src/shared/i18n/locales/zh.json';

/**
 * МАТЧИ СБОРНЫХ: РЕЕСТР В БАЗЕ, ИМЕНА НА ЭКРАНЕ И СРОКИ У ЗАПРОСОВ.
 *
 * ⚠️ РЕЕСТР ЖИВЁТ В БАЗЕ, А ИМЕНА — В ЛОКАЛЯХ, И РАЗОЙТИСЬ ИМ НИЧТО НЕ МЕШАЕТ.
 * Турнир, добавленный в `espn_national_league` и забытый в локалях, не
 * исчезнет и не подсветится — он выйдет на экран как «Concacaf Gold Cup»
 * посреди русского списка, через `readableSportKey`. Это не ошибка, которую
 * видно в логах: это ошибка, которую видно только глазами игрока.
 *
 * Поэтому источником правды здесь взята САМА МИГРАЦИЯ: ключи вычитываются из
 * её `insert`, а не переписываются в тест. Переписанный список — это третья
 * копия, и она разошлась бы первой.
 */

const MIGRATION = readFileSync('supabase/migrations/national_fixtures.sql', 'utf8');
const SCHEDULE = readFileSync('supabase/migrations/schedule_national_fixtures.sql', 'utf8');
const FUNCTION = readFileSync('supabase/functions/football-national/index.ts', 'utf8');

/** Строки реестра: ('espn.slug', 'sport_key', 'Название', активен, примечание). */
interface RegistryRow { slug: string; key: string; active: boolean }

function registry(): RegistryRow[] {
  // Берём только тело `values (...)` у вставки в espn_national_league — иначе
  // в улов попадают CHECK-ограничения и комментарии, как это уже случилось
  // в test/content_rights.test.ts.
  const block = MIGRATION.match(
    /insert\s+into\s+public\.espn_national_league[\s\S]*?values([\s\S]*?)on\s+conflict/i,
  );
  if (!block) throw new Error('в миграции не нашлась вставка в espn_national_league');
  const rows: RegistryRow[] = [];
  for (const m of block[1].matchAll(
    /\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'[^']*'\s*,\s*(true|false)/gi,
  )) {
    rows.push({ slug: m[1], key: m[2], active: m[3].toLowerCase() === 'true' });
  }
  return rows;
}

const LOCALES = { ru, en, es, pt, fr, ar, ja, ko, zh } as const;

describe('реестр турниров сборных', () => {
  it('не пуст — иначе всё ниже проверяет пустоту', () => {
    // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ ВСЕХ ОСТАЛЬНЫХ ПРОВЕРОК ФАЙЛА. `for` по пустому
    // списку проходит молча, и разбор, сломавшийся об изменённый отступ,
    // выглядел бы как «всё хорошо».
    expect(registry().length).toBeGreaterThan(10);
  });

  it('каждый турнир реестра перечислен в KNOWN_SPORT_KEYS', () => {
    const known = new Set<string>(KNOWN_SPORT_KEYS);
    const missing = registry().map((r) => r.key).filter((k) => !known.has(k));
    expect(missing, 'турнир есть в базе, но не назван во фронтенде').toEqual([]);
  });

  it('контроль: выдуманный турнир в KNOWN_SPORT_KEYS не значится', () => {
    expect(new Set<string>(KNOWN_SPORT_KEYS).has('soccer_made_up_cup')).toBe(false);
  });

  it.each(Object.keys(LOCALES))('%s называет каждый турнир сборных', (lang) => {
    const dict = (LOCALES as Record<string, { leagues: Record<string, string> }>)[lang];
    const missing = registry()
      .map((r) => leagueKey(r.key).replace('leagues.', ''))
      .filter((k) => !dict.leagues[k]);
    expect(missing, `${lang}: турнир выйдет на экран сырым ключом`).toEqual([]);
  });

  /**
   * ⚠️ ЛИГА НАЦИЙ УЕФА ВЫКЛЮЧЕНА НАМЕРЕННО, И ЭТО ЕДИНСТВЕННОЕ, ЧТО МЕШАЕТ
   * ЗАДВОИТЬ КАЖДЫЙ ЕЁ МАТЧ. Её расписание ведёт платный провайдер, под
   * своими идентификаторами; ESPN отдал бы те же матчи под своими, с
   * приставкой `espn:`, и в календаре встали бы две строки на одну игру.
   *
   * Строка в реестре стоит именно ВЫКЛЮЧЕННОЙ, а не отсутствует: отсутствие
   * читается как «забыли», выключенность — как «решили».
   */
  it('Лигу наций УЕФА реестр знает, но не спрашивает', () => {
    const uefa = registry().find((r) => r.slug === 'uefa.nations');
    expect(uefa, 'строки про uefa.nations нет вовсе — а должна быть, выключенной')
      .toBeTruthy();
    expect(uefa!.active).toBe(false);
    expect(uefa!.key).toBe('soccer_uefa_nations_league');
  });

  it('у выключенной строки записана ПРИЧИНА, а не пустота', () => {
    // Примечание — пятое поле той же строки. Без него следующий читатель
    // включит её обратно, потому что «почему выключено» нигде не написано.
    const line = MIGRATION.split('\n').find((l) => l.includes("'uefa.nations'"));
    expect(line).toBeTruthy();
    const tail = MIGRATION.slice(MIGRATION.indexOf("'uefa.nations'"));
    expect(tail.slice(0, 400)).toMatch(/задвои|провайдер/i);
  });
});

describe('football-national — сроки и режимы', () => {
  it('у КАЖДОГО обращения наружу есть срок', () => {
    // ⚠️ ЗАПРОС БЕЗ СРОКА НЕ ПАДАЕТ — ОН ВИСИТ. Висящий сборщик неотличим от
    // работающего, и ровно этим ночной обход шёл 3 ч 36 мин при бюджете 80
    // минут. Считаем вызовы fetch и требуем столько же сигналов.
    const fetches = [...FUNCTION.matchAll(/\bfetch\(/g)].length;
    const signals = [...FUNCTION.matchAll(/AbortSignal\.timeout\(/g)].length;
    expect(fetches).toBeGreaterThan(0);
    expect(signals, 'есть fetch без AbortSignal.timeout').toBe(fetches);
  });

  it('у прогона целиком тоже есть потолок', () => {
    expect(FUNCTION).toMatch(/RUN_MS\s*=\s*[\d_]+/);
    expect(FUNCTION).toMatch(/Date\.now\(\)\s*-\s*startedAt\s*>\s*RUN_MS/);
  });

  it('режим scores спрашивает ДРУГОЙ реестр, чем полный обход', () => {
    // Иначе «дешёвый» режим обошёл бы все турниры и стоил бы ровно столько
    // же, сколько полный, — только 288 раз в сутки вместо двух.
    expect(FUNCTION).toContain('national_leagues_in_play');
    expect(FUNCTION).toContain('espn_national_leagues');
    expect(FUNCTION).toMatch(/mode === "scores"\s*\?\s*"national_leagues_in_play"/);
  });

  it('режим scores берёт месяцы окна, а не три месяца', () => {
    expect(FUNCTION).toMatch(/mode === "scores"\s*\?\s*scoreMonths\(now\)\s*:\s*months\(now\)/);
  });
});

describe('расписание матчей сборных', () => {
  it('частый режим не поднимает функцию, когда матчей в окне нет', () => {
    // ⚠️ ЭТО И ЕСТЬ ЦЕНА ВОПРОСА. Без этой проверки 288 заходов в сутки
    // поднимали бы контейнер ради ответа «матчей нет».
    expect(SCHEDULE).toMatch(/if p_mode = 'scores' then[\s\S]*?national_leagues_in_play\(\)/);
    expect(SCHEDULE).toMatch(/if v_leagues = 0 then\s*\n\s*return null;/);
  });

  it('неизвестный режим — исключение, а не тихий полный обход', () => {
    expect(SCHEDULE).toMatch(/p_mode not in \('calendar', 'scores'\)/);
    expect(SCHEDULE).toMatch(/raise exception/);
  });

  it('оба задания заведены и зовут разные режимы', () => {
    expect(SCHEDULE).toMatch(/'fetch-national-fixtures',[\s\S]*?fetch_national_fixtures\('calendar'\)/);
    expect(SCHEDULE).toMatch(/'fetch-national-scores',[\s\S]*?fetch_national_fixtures\('scores'\)/);
  });

  it('обе функции расписания закрыты от anon', () => {
    // Реестр сборных читать некому, кроме самой функции: у anon ceiling в
    // три секунды и нет причин ходить в служебные RPC.
    for (const fn of ['national_leagues_in_play()', 'fetch_national_fixtures(text)']) {
      expect(SCHEDULE).toContain(`revoke all on function public.${fn} from public, anon, authenticated;`);
      expect(SCHEDULE).toContain(`grant execute on function public.${fn} to service_role;`);
    }
  });
});

describe('запись матчей сборных', () => {
  it('идентификатор несёт приставку espn:', () => {
    // ⚠️ БЕЗ ПРИСТАВКИ ОДИН МАТЧ ОДНАЖДЫ ЗАТРЁТ ДРУГОЙ. У платного провайдера
    // id — собственный хеш, у ESPN — числовая строка; пересечение не
    // исключено ничем, а заметить его можно будет только по пропавшему матчу.
    expect(MIGRATION).toMatch(/'espn:'\s*\|\|\s*\(r->>'event_id'\)/);
  });

  it('счёт не стирается пустотой, а completed идёт только вперёд', () => {
    expect(MIGRATION).toMatch(/home_score\s*=\s*coalesce\(excluded\.home_score,\s*f\.home_score\)/);
    expect(MIGRATION).toMatch(/completed\s*=\s*f\.completed or excluded\.completed/);
  });
});
