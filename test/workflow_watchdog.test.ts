import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * У КАЖДОГО ПРОГОНА ПО РАСПИСАНИЮ ОБЯЗАН БЫТЬ СТОРОЖ.
 *
 * ⚠️ ЭТОТ ТЕСТ СТЕРЕЖЁТ СПОСОБ ЛОМАТЬСЯ, А НЕ ФАЙЛ. Ночной обход дважды терял
 * половину себя, и оба раза в списке Actions не было НИ ОДНОЙ красной строки:
 *
 *   12–21.09.2026  десять прогонов подряд помечены «cancelled» — job упирался
 *                  в свой потолок, и 21 шаг из 28 не запускался. «Cancelled»
 *                  читается как «кто-то отменил вручную».
 *   22.09.2026     срок в 80 минут не спас: он проверялся ПЕРЕД шагом и не мог
 *                  прервать уже идущий — первый шаг шёл 3 ч 36 мин.
 *
 * Данные при этом говорили прямо: club_roster не обновлялся 15 суток,
 * soccerwiki_player и player_transfer — по 14. Две недели без второй половины
 * конвейера, и узнал об этом человек, а не проверка.
 *
 * Разница между «отменён» и «упал» не косметическая: о ПАДЕНИИ прогона по
 * расписанию GitHub шлёт владельцу письмо, об отмене — нет. Сторож существует
 * ровно затем, чтобы молчание становилось падением.
 *
 * ⚠️ И ПОЭТОМУ ПРОВЕРЯЕТСЯ НЕ «СТОРОЖ ЕСТЬ У ЭТИХ ТРЁХ», А «СТОРОЖ ЕСТЬ У
 * ВСЕХ». Четвёртый workflow по расписанию, заведённый без сторожа, вернул бы
 * ровно ту же тишину — и выписанный список из трёх имён этого бы не заметил.
 */

const DIR = '.github/workflows';

function workflows(): { name: string; src: string }[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => ({ name: f, src: readFileSync(`${DIR}/${f}`, 'utf8') }));
}

/** Запускается ли по расписанию. `on:` в этих файлах всегда в начале. */
function scheduled(src: string): boolean {
  const head = src.slice(0, src.indexOf('\njobs:'));
  return /^\s{2}schedule:/m.test(head);
}

/** Имена job'ов верхнего уровня — по отступу в два пробела после `jobs:`. */
function jobNames(src: string): string[] {
  const body = src.slice(src.indexOf('\njobs:') + 1);
  return [...body.matchAll(/^ {2}([a-z][\w-]*):\s*$/gm)].map((m) => m[1]);
}

/** Тело job'а: от его имени до следующего имени того же уровня. */
function jobBody(src: string, name: string): string {
  const body = src.slice(src.indexOf('\njobs:') + 1);
  const start = body.search(new RegExp(`^ {2}${name}:\\s*$`, 'm'));
  expect(start, `job ${name} не найден`).toBeGreaterThanOrEqual(0);
  const rest = body.slice(start + 1);
  const next = rest.search(/^ {2}[a-z][\w-]*:\s*$/m);
  return next < 0 ? rest : rest.slice(0, next);
}

describe('сторож у прогонов по расписанию', () => {
  const all = workflows();
  const byCron = all.filter((w) => scheduled(w.src));

  it('расписания вообще находятся — иначе проверка пустая', () => {
    // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ РАЗБОРА. Ошибись регулярка, и цикл ниже
    // прошёл бы по пустому списку: зелено и бессмысленно.
    expect(all.length).toBeGreaterThan(3);
    expect(byCron.length).toBeGreaterThanOrEqual(3);
    expect(byCron.map((w) => w.name).sort())
      .toEqual([
        'daily-enrich.yml',
        'espn-results-refresh.yml',
        'forecast.yml',
        'multimarket-odds-collection.yml',
        'player-honours.yml',
        'player-market-value-refresh.yml',
        'player-profile-data.yml',
        'player-stats.yml',
        'profile-backfill-queue.yml',
        'soccerwiki-roster-refresh.yml',
        'women-stats-backfill.yml',
      ]);
  });

  it('profile workflow changes do not queue a duplicate profile batch', () => {
    const profile = all.find((w) => w.name === 'player-profile-data.yml');
    const market = all.find((w) => w.name === 'player-market-value-refresh.yml');
    expect(profile, 'profile workflow не найден').toBeDefined();
    expect(market, 'market-value workflow не найден').toBeDefined();
    expect(profile!.src).not.toContain("      - '.github/workflows/player-profile-data.yml'");
    expect(market!.src).toContain("      - '.github/workflows/player-profile-data.yml'");
  });

  it('team forecasts wait for the successful match-results refresh', () => {
    const candidates = all.find((w) => w.name === 'award-and-tournament-candidates.yml');
    expect(candidates, 'candidate workflow не найден').toBeDefined();
    expect(candidates!.src).not.toMatch(/^\s{2}schedule:/m);
    expect(candidates!.src).toMatch(/workflow_run:/);
    expect(candidates!.src).toContain('"player-profile-data", "player-market-value-refresh", "espn-results-refresh", "player-stats"');
    expect(candidates!.src).toContain('--skip-team-candidates');
  });

  it('team match ingestion runs independently of the slow player crawl', () => {
    const espn = all.find((w) => w.name === 'espn-results-refresh.yml');
    const stats = all.find((w) => w.name === 'player-stats.yml');
    const candidates = all.find((w) => w.name === 'award-and-tournament-candidates.yml');
    expect(espn, 'ESPN results workflow не найден').toBeDefined();
    expect(stats, 'player-stats workflow не найден').toBeDefined();
    expect(candidates, 'candidate workflow не найден').toBeDefined();
    expect(espn!.src).toContain('python3 espn_stats.py --days "$days"');
    expect(espn!.src).toContain('rebuild_club_matches');
    expect(stats!.src).not.toContain('name: Collect (ESPN)');
    expect(stats!.src).toContain('for fn in rebuild_club_matches refresh_stats_planner');
    expect(candidates!.src).toContain('[ "$UPSTREAM_WORKFLOW_NAME" = "espn-results-refresh" ]');
    expect(candidates!.src).toContain('[ "$UPSTREAM_WORKFLOW_NAME" = "player-stats" ]');
  });

  it('у каждого есть job `watch`, который идёт ВСЕГДА', () => {
    for (const w of byCron) {
      const names = jobNames(w.src);
      expect(names, `${w.name}: нет job'а watch`).toContain('watch');
      const body = jobBody(w.src, 'watch');
      // Без `if: always()` сторож не запустится ровно тогда, когда он нужен —
      // после упавшего или отменённого job'а.
      expect(body, `${w.name}: у watch нет if: always()`).toMatch(/^\s{4}if: always\(\)\s*$/m);
    }
  });

  it('сторож ждёт ВСЕ остальные job\'ы, а не первый попавшийся', () => {
    // Пропущенный в `needs` job — это job, чей провал сторож не увидит.
    for (const w of byCron) {
      const others = jobNames(w.src).filter((n) => n !== 'watch');
      const body = jobBody(w.src, 'watch');
      const needs = /needs:\s*\[([^\]]*)\]/.exec(body);
      expect(needs, `${w.name}: у watch нет needs: [...]`).not.toBeNull();
      const listed = needs![1].split(',').map((x) => x.trim()).filter(Boolean);
      expect(listed.sort(), `${w.name}: сторож не ждёт часть job'ов`)
        .toEqual(others.sort());
    }
  });

  it('сторож проверяет ИСХОД, а не просто существует', () => {
    // Пустой сторож зеленел бы всегда — это худший вид проверки.
    for (const w of byCron) {
      const body = jobBody(w.src, 'watch');
      expect(body, `${w.name}: сторож не сравнивает исход с success`)
        .toMatch(/= "success"/);
      // ⚠️ И ЧЕРЕЗ env, А НЕ ПОДСТАНОВКОЙ В `run`. Склейка команды с
      // выражением ${{ }} — приём, который однажды сработает на чужом
      // значении; заводить его не стоит даже там, где значение своё.
      expect(body, `${w.name}: исход подставлен прямо в run`)
        .not.toMatch(/run:[\s\S]*?\$\{\{\s*needs\./);
    }
  });

  it('у ночного обхода сторож смотрит ещё и на данные', () => {
    // Успешный job и наполненные таблицы — разные утверждения: обход может
    // закончиться нулём, не дойдя до половины шагов. Это и случилось.
    const body = jobBody(readFileSync(`${DIR}/daily-enrich.yml`, 'utf8'), 'watch');
    expect(body).toContain('scripts/check-nightly.mjs');
  });
});
