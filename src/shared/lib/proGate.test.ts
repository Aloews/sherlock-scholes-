import { describe, it, expect } from 'vitest';
import { requiresPro, FREE_ROUTES, hiddenForNonPro } from './proGate';

describe('proGate', () => {
  it('пускает ядро игры без подписки', () => {
    for (const p of ['/', '/lobby', '/game', '/end', '/training', '/tutorial']) {
      expect(requiresPro(p), p).toBe(false);
    }
  });

  // ⚠️ САМАЯ ОПАСНАЯ ОШИБКА ЭТОЙ СХЕМЫ, И ОНА МОЛЧАЛИВАЯ. Не-Pro на закрытом
  // маршруте отправляется на `/pro`. Закрой `/pro` — и он отправится сам на
  // себя: экран подписки станет недостижим ровно для тех, кому он нужен, а
  // приложение на вид просто «зависнет» на переходе.
  it('НИКОГДА не закрывает сам экран подписки', () => {
    expect(requiresPro('/pro')).toBe(false);
    expect(requiresPro('/pro?from=%2Fnews')).toBe(false);
    expect(requiresPro('/pro/')).toBe(false);
  });

  it('профиль открыт: оттуда управляют подпиской', () => {
    expect(requiresPro('/profile')).toBe(false);
  });

  it('закрывает всё остальное', () => {
    for (const p of ['/collection', '/friends', '/matches', '/fantasy', '/chess',
                     '/digest', '/news', '/minigames', '/arena', '/table',
                     '/ratings', '/clubs', '/quiz', '/famous', '/squad']) {
      expect(requiresPro(p), p).toBe(true);
    }
  });

  it('закрывает маршруты с параметром', () => {
    expect(requiresPro('/club/real-madrid')).toBe(true);
    expect(requiresPro('/table/england')).toBe(true);
  });

  // ⚠️ ОБХОД ЧЕРЕЗ СТРОКУ ЗАПРОСА. `/collection?view=stats` — это тот же экран
  // коллекции, и с главной на него ведут ДВЕ кнопки («рейтинг» и «команды»).
  // Сравнивай ворота с полным URL — и обе кнопки открыли бы платное бесплатно.
  it('строка запроса не открывает закрытый экран', () => {
    expect(requiresPro('/collection?view=stats')).toBe(true);
    expect(requiresPro('/collection?view=clubs')).toBe(true);
    expect(requiresPro('/news#top')).toBe(true);
  });

  it('хвостовой слэш не открывает закрытый экран', () => {
    expect(requiresPro('/news/')).toBe(true);
    expect(requiresPro('/')).toBe(false);
  });

  // Белый список: неизвестное закрыто, а не открыто. Новый маршрут, забытый в
  // списке, обязан оказаться ЗА подпиской — эту ошибку видно сразу.
  it('неизвестный маршрут закрыт', () => {
    expect(requiresPro('/whatever-new')).toBe(true);
    expect(requiresPro('')).toBe(false); // пустой путь = главная
  });

  it('список открытого не пуст и содержит подписку', () => {
    expect(FREE_ROUTES.length).toBeGreaterThan(0);
    expect(FREE_ROUTES).toContain('/pro');
  });
});

/**
 * ПРЯТАТЬ ЛИ РАЗДЕЛ ОТ НЕПОДПИСАННОГО.
 *
 * ⚠️ ПРОВЕРКА ПО ПРОСЬБЕ ВЛАДЕЛЬЦА, И У НЕЁ ДВЕ СТОРОНЫ. «Спрятать всё» ломает
 * подписчику главную ровно так же, как «не прятать ничего» ломает замысел, —
 * поэтому проверяются обе, и отдельно третья: пока статус не известен, не
 * прячем НИЧЕГО, иначе разделы у подписчика мигают.
 */
describe('прятать раздел от неподписанного', () => {
  const guest = { isPro: false, proLoaded: true };
  const member = { isPro: true, proLoaded: true };
  const unknown = { isPro: false, proLoaded: false };

  it.each(['/matches', '/news', '/digest', '/duel', '/spotlight', '/amateur'])(
    'без подписки %s спрятан', (path) => {
      expect(hiddenForNonPro(path, guest)).toBe(true);
    });

  it.each(['/', '/game', '/training', '/profile', '/pro'])(
    'бесплатный %s виден всегда', (path) => {
      expect(hiddenForNonPro(path, guest)).toBe(false);
      expect(hiddenForNonPro(path, member)).toBe(false);
    });

  it('подписчику не спрятано ничего', () => {
    for (const path of ['/matches', '/news', '/duel', '/amateur']) {
      expect(hiddenForNonPro(path, member)).toBe(false);
    }
  });

  // ⚠️ ГЛАВНАЯ СТРОКА ФАЙЛА: пока подписка не проверена, прятать нельзя.
  // Иначе подписчик видит главную без своих разделов, и они «появляются».
  it('пока статус не проверен — не прячем ничего', () => {
    for (const path of ['/matches', '/news', '/duel']) {
      expect(hiddenForNonPro(path, unknown)).toBe(false);
    }
  });

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: правило не отвечает одинаково на всё. Проверка,
  // у которой ответ один, прошла бы и у `() => false`, и у `() => true`.
  it('контроль: правило различает случаи', () => {
    expect(hiddenForNonPro('/duel', guest)).not.toBe(hiddenForNonPro('/duel', member));
    expect(hiddenForNonPro('/duel', guest)).not.toBe(hiddenForNonPro('/game', guest));
  });

  // ⚠️ ПОДПИСАТЬСЯ ОБЯЗАНО БЫТЬ ОТКУДА. Спрячь `/pro` вместе с остальным — и
  // неподписанный останется с алиасом навсегда, без пути к оплате.
  it('экран подписки не прячется никогда', () => {
    expect(hiddenForNonPro('/pro', guest)).toBe(false);
  });
});
