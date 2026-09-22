import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * ВРЕМЯ НОЧНОГО ОБХОДА ОБЯЗАНО БЫТЬ РАСПРЕДЕЛЕНО, А НЕ ЗАНЯТО ПЕРВЫМ ШАГОМ.
 *
 * ⚠️ ЭТО ПРОВЕРКА ПО СЛЕДАМ ДЕСЯТИ ПОТЕРЯННЫХ НОЧЕЙ. Прогоны daily-enrich с 12
 * по 21 сентября 2026 все до одного помечены «cancelled». Разбор одного из
 * них (run 35588417382):
 *
 *   шаг «Run daily enrichment»            10:23 → 15:45   5 ч 22 мин, exit 0
 *   шаг «Collect pageviews…»              15:45 → 15:57   убит на полуслове
 *   ещё ДВАДЦАТЬ ОДИН шаг                                 skipped, не запускались
 *   ##[error] The runner has received a shutdown signal … exit code 143
 *
 * То есть первый шаг, у которого не было НИКАКОГО потолка по времени, съедал
 * весь job (330 минут), дальше GitHub убивал runner, и вторая половина
 * конвейера не выполнялась вовсе: эмблемы, стоимости, трансферы, мост на
 * Transfermarkt, составы, связывание составов с колодой, новые карточки,
 * Soccer Wiki и ревизия колоды.
 *
 * ⚠️ И НИ ОДНА ПРОВЕРКА ЭТОГО НЕ ВИДЕЛА. `if: always()` не спасает: при отмене
 * job'а шаги не запускаются вообще. В списке Actions это выглядит как
 * «cancelled», то есть читается как «кто-то отменил вручную», а сам
 * оркестратор честно печатал «ok» по своим шагам и выходил с нулём.
 *
 * Поэтому здесь проверяется арифметика, а не наличие строчки: у длинных шагов
 * есть свой срок, и сумма сроков ОСТАВЛЯЕТ время остальным.
 */

const WF = '.github/workflows/daily-enrich.yml';

function workflow(): string {
  return readFileSync(WF, 'utf8');
}

/** `timeout-minutes` job'а enrich. */
function jobTimeout(): number {
  const m = /timeout-minutes:\s*(\d+)/.exec(workflow());
  expect(m, 'у job нет timeout-minutes вовсе').not.toBeNull();
  return Number(m![1]);
}

/** Все `--minutes N` из строк запуска. */
function declaredMinutes(): number[] {
  return [...workflow().matchAll(/--minutes\s+(\d+)/g)].map((m) => Number(m[1]));
}

describe('время ночного обхода', () => {
  it('у оркестратора есть свой срок — без него он съедает ночь', () => {
    const line = /run:\s*python docs\/daily_enrich\.py([^\n]*)/.exec(workflow());
    expect(line, 'шага «Run daily enrichment» больше нет — проверку надо переписать')
      .not.toBeNull();
    expect(line![1]).toMatch(/--minutes\s+\d+/);
  });

  it('у сбора просмотров тоже есть срок', () => {
    const line = /run:[^\n]*cards_pageviews_world\.py([^\n]*)/.exec(workflow());
    expect(line, 'шага сбора просмотров больше нет — проверку надо переписать')
      .not.toBeNull();
    expect(line![1]).toMatch(/--minutes\s+\d+/);
  });

  it('сумма сроков оставляет время остальным шагам', () => {
    // ⚠️ ИМЕННО ЗДЕСЬ БЫЛА ПОЛОМКА, И ОНА АРИФМЕТИЧЕСКАЯ. Пока у первого шага
    // срока не было, «сумма» равнялась потолку job'а, и на два десятка шагов
    // ниже оставалось НОЛЬ. Запас в треть потолка — не красивое число: это
    // время, которое эти шаги занимали, когда ещё успевали отработать.
    const total = declaredMinutes().reduce((a, b) => a + b, 0);
    const cap = jobTimeout();
    expect(total).toBeGreaterThan(0);
    expect(total, `сроки шагов (${total} мин) не оставляют трети от потолка (${cap} мин)`)
      .toBeLessThanOrEqual(cap - Math.round(cap / 3));
  });

  it('потолок job укладывается в предел GitHub', () => {
    // 360 минут — жёсткий предел платформы; больше просто не запустится.
    expect(jobTimeout()).toBeLessThanOrEqual(360);
  });
});
