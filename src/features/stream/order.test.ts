import { describe, it, expect } from 'vitest';
import { orderChannels, nextAlive, PINNED } from './order';
import type { Channel } from './playlist';

const ch = (name: string, url = name): Channel => ({ name, group: 'SPORT 🏆', logo: null, url });

describe('orderChannels', () => {
  it('lifts a pinned channel above an unpinned one', () => {
    const out = orderChannels([ch('Divi Sport'), ch('Setanta Sports 1 HD')]);
    expect(out.map((c) => c.name)).toEqual(['Setanta Sports 1 HD', 'Divi Sport']);
  });

  it('keeps pinned channels in the order PINNED declares, not playlist order', () => {
    const out = orderChannels([ch('EUROSPORT 1'), ch('Viasat Sport'), ch('Setanta Sports 2 HD')]);
    expect(out.map((c) => c.name)).toEqual(['Setanta Sports 2 HD', 'Viasat Sport', 'EUROSPORT 1']);
  });

  // Устойчивость — не деталь: без неё незакреплённые тасовались бы на каждой
  // загрузке, хотя ранг у них один и тот же.
  it('leaves unpinned channels in playlist order', () => {
    const out = orderChannels([ch('Divi Sport'), ch('AYM HD'), ch('UFC Network')]);
    expect(out.map((c) => c.name)).toEqual(['Divi Sport', 'AYM HD', 'UFC Network']);
  });

  it('matches case-insensitively and on a substring', () => {
    expect(orderChannels([ch('X'), ch('arena sport 4 hd serbian')])[0].name)
      .toBe('arena sport 4 hd serbian');
  });

  it('does not mutate its input', () => {
    const input = [ch('Divi Sport'), ch('Setanta Sports 1 HD')];
    orderChannels(input);
    expect(input.map((c) => c.name)).toEqual(['Divi Sport', 'Setanta Sports 1 HD']);
  });

  it('survives an empty list', () => {
    expect(orderChannels([])).toEqual([]);
  });

  // Замер 25.08.2026: канал отдаёт 404. Поднять его наверх значит вернуть тот
  // самый баг — первый канал играет сам, и мёртвый первый ломает весь экран.
  it('does not pin the channels that measured dead', () => {
    expect(PINNED.some((p) => 'матч! планета'.includes(p))).toBe(false);
    expect(PINNED.some((p) => 'khl'.includes(p))).toBe(false);
    expect(PINNED.some((p) => 'futbol uz'.includes(p))).toBe(false);
  });
});

describe('nextAlive', () => {
  const list = [ch('A'), ch('B'), ch('C')];

  it('starts at the first channel when nothing is playing yet', () => {
    expect(nextAlive(list, null, new Set())).toBe('A');
  });

  it('moves to the one after the current', () => {
    expect(nextAlive(list, 'A', new Set())).toBe('B');
  });

  it('skips over channels already known dead', () => {
    expect(nextAlive(list, 'A', new Set(['B']))).toBe('C');
  });

  it('wraps past the end back to the start', () => {
    expect(nextAlive(list, 'C', new Set())).toBe('A');
  });

  it('wraps and still skips the dead', () => {
    expect(nextAlive(list, 'B', new Set(['C']))).toBe('A');
  });

  // Отличать «все отказали» от «список пуст» обязан экран, поэтому обе ветки
  // возвращают null, но приходят к нему разными путями.
  it('returns null when every channel is dead', () => {
    expect(nextAlive(list, 'A', new Set(['A', 'B', 'C']))).toBeNull();
  });

  it('returns null on an empty list', () => {
    expect(nextAlive([], null, new Set())).toBeNull();
  });

  it('starts from the beginning when the current url is no longer in the list', () => {
    expect(nextAlive(list, 'GONE', new Set())).toBe('A');
  });

  it('can return the current channel again when it is the only live one', () => {
    expect(nextAlive(list, 'A', new Set(['B', 'C']))).toBe('A');
  });
});
