import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tickIntensity, TICK_FROM } from './sounds';

/**
 * ⚠️ ЭТИ ТЕСТЫ СТЕРЕГУТ ДВА УТВЕРЖДЕНИЯ, КОТОРЫЕ ЛЕГКО СТАНОВЯТСЯ ЛОЖНЫМИ
 * МОЛЧА.
 *
 * Первое: «звук ничего не весит». Владелец предположил, что звуки «много
 * грузят и съедают трафика», и предложил их убрать. Сегодня грузить нечего —
 * всё синтезируется в коде. Но добавить один mp3 «просто послушать» проще
 * простого, и тогда ответ «трафика нет» превратится во враньё, а знать об
 * этом будет неоткуда.
 *
 * Второе: «тревога нарастает». Обратный отсчёт раздражал именно тем, что
 * десять секунд подряд звучал одинаково. Ровный отсчёт вернётся одной
 * строчкой, и на слух это заметит только тот, кто помнит, как было.
 */

describe('звук ничего не весит', () => {
  const AUDIO = /\.(mp3|wav|ogg|m4a|aac|flac|opus|weba)$/i;

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else out.push(p);
    }
    return out;
  }

  it('в public/ нет ни одного звукового файла', () => {
    const found = walk('public').filter((f) => AUDIO.test(f));
    expect(found, `появились звуковые файлы: ${found.join(', ')}`).toEqual([]);
  });

  it('в src/ тоже нет — звук собирается осцилляторами, а не грузится', () => {
    const found = walk('src').filter((f) => AUDIO.test(f));
    expect(found, `появились звуковые файлы: ${found.join(', ')}`).toEqual([]);
  });
});

describe('обратный отсчёт нарастает', () => {
  it('вне последних секунд молчит', () => {
    expect(tickIntensity(TICK_FROM + 1)).toBe(0);
    expect(tickIntensity(60)).toBe(0);
  });

  it('после нуля молчит', () => {
    expect(tickIntensity(0)).toBe(0);
    expect(tickIntensity(-3)).toBe(0);
  });

  it('на дальней границе — едва слышно', () => {
    expect(tickIntensity(TICK_FROM)).toBeCloseTo(0.1, 5);
  });

  it('на последней секунде — в полную силу', () => {
    expect(tickIntensity(1)).toBe(1);
  });

  it('РАСТЁТ НА КАЖДОЙ СЕКУНДЕ, а не ступенькой в конце', () => {
    const seq = Array.from({ length: TICK_FROM }, (_, i) => tickIntensity(TICK_FROM - i));
    for (let i = 1; i < seq.length; i++) {
      expect(seq[i], `секунда ${TICK_FROM - i} не громче предыдущей`).toBeGreaterThan(seq[i - 1]);
    }
  });

  it('никогда не выходит за 0..1 — громкость домножается на это число', () => {
    for (let r = -5; r <= TICK_FROM + 5; r++) {
      const v = tickIntensity(r);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('окно настраивается: с другим `from` шкала та же', () => {
    expect(tickIntensity(5, 5)).toBeCloseTo(0.2, 5);
    expect(tickIntensity(1, 5)).toBe(1);
    expect(tickIntensity(6, 5)).toBe(0);
  });
});
