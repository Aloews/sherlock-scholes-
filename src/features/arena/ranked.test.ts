import { describe, it, expect } from 'vitest';
import { matchOutcome, isRankedStatus, RANKED_WIN_SCORE } from './ranked';

describe('matchOutcome', () => {
  it('матч ещё идёт — исхода нет', () => {
    expect(matchOutcome({ left: 4, right: 3 }, 'left')).toBeNull();
    expect(matchOutcome({ left: 0, right: 0 }, 'right')).toBeNull();
  });

  it('хост слева: его счёт и есть его счёт', () => {
    expect(matchOutcome({ left: 5, right: 2 }, 'left'))
      .toEqual({ scored: 5, conceded: 2, won: true });
  });

  it('ГОСТЬ СПРАВА: счёт переворачивается под него', () => {
    // Счёт в состоянии — про поле, а не про игрока. Отправить его как есть
    // значило бы прислать серверу зеркальную заявку, встречная проверка её не
    // подтвердит, и оба матча повиснут в pending. Выглядело бы это как
    // «сервер не засчитывает», а не как перепутанные стороны.
    expect(matchOutcome({ left: 2, right: 5 }, 'right'))
      .toEqual({ scored: 5, conceded: 2, won: true });
  });

  it('две стороны одного матча дают зеркальные заявки', () => {
    const score = { left: 5, right: 3 };
    const host = matchOutcome(score, 'left')!;
    const guest = matchOutcome(score, 'right')!;
    // Ровно то, что сверяет record_arena_result.
    expect(host.scored).toBe(guest.conceded);
    expect(host.conceded).toBe(guest.scored);
    expect(host.won).toBe(true);
    expect(guest.won).toBe(false);
  });

  it('проигравший тоже получает исход — он обязан подтвердить', () => {
    expect(matchOutcome({ left: 1, right: 5 }, 'left'))
      .toEqual({ scored: 1, conceded: 5, won: false });
  });

  it('порог совпадает с игровым циклом', () => {
    expect(RANKED_WIN_SCORE).toBe(5);
    expect(matchOutcome({ left: 5, right: 0 }, 'left')).not.toBeNull();
  });
});

describe('isRankedStatus', () => {
  it('знакомые ответы', () => {
    expect(isRankedStatus('confirmed')).toBe(true);
    expect(isRankedStatus('pending')).toBe(true);
  });

  it('незнакомый ответ не считается успехом', () => {
    // Функция может обзавестись новым отказом; молча принять его за успех
    // значит показать игроку зачтённый матч, которого нет в таблице.
    expect(isRankedStatus('teapot')).toBe(false);
    expect(isRankedStatus(null)).toBe(false);
    expect(isRankedStatus(undefined)).toBe(false);
  });
});
