import { describe, it, expect } from 'vitest';
import { requiresPro, FREE_ROUTES } from './proGate';

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
