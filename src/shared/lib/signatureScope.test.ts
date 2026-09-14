import { describe, it, expect } from 'vitest';
import { needsSignature } from './signatureScope';

/**
 * КУДА ЕДЕТ ПОДПИСЬ TELEGRAM.
 *
 * ⚠️ ТЕСТ ПО ЖИВОЙ ПОЛОМКЕ, И ОНА БЫЛА ТИХОЙ. Подпись ставилась на КАЖДЫЙ
 * запрос клиента Supabase — в том числе на `functions.invoke`. Браузер на
 * нестандартный заголовок шлёт предзапрос OPTIONS; список разрешённых у
 * Edge-функций прибит гвоздями, `x-tg-init-data` в нём не было, и браузер
 * блокировал вызов ЦЕЛИКОМ, ещё до отправки.
 *
 * Снаружи: «сводка новостей по кнопке „собрать сводку“ не работает». Вместе с
 * ней молча перестали работать вход в комнату, ОПЛАТА Pro и загрузка
 * логотипа. Сервер при этом был жив — прямой POST отвечал 200 за 2.6 с, —
 * поэтому ни curl, ни сотня проверок этого не видели.
 */
describe('подпись Telegram едет только туда, где её читают', () => {
  const BASE = 'https://konoavrduynecxblqfvq.supabase.co';

  it.each([
    `${BASE}/rest/v1/rpc/player_index`,
    `${BASE}/rest/v1/cards?select=id`,
    `${BASE}/realtime/v1/websocket`,
  ])('PostgREST и realtime подпись получают: %s', (url) => {
    expect(needsSignature(url)).toBe(true);
  });

  // ⚠️ ГЛАВНЫЕ СТРОКИ ФАЙЛА. Ровно эти четыре зовёт `functions.invoke`.
  it.each([
    `${BASE}/functions/v1/digest-summary`,
    `${BASE}/functions/v1/livekit-token`,
    `${BASE}/functions/v1/tg-pay`,
    `${BASE}/functions/v1/amateur-logo`,
  ])('Edge-функция подпись НЕ получает: %s', (url) => {
    expect(needsSignature(url)).toBe(false);
  });

  // ⚠️ И ХРАНИЛИЩЕ ТОЖЕ НЕТ: там свои подписанные ссылки, а заголовок так же
  // потребовал бы предзапроса.
  it('storage подпись не получает', () => {
    expect(needsSignature(`${BASE}/storage/v1/object/public/logos/a.png`)).toBe(false);
  });

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: правило не «всегда нет». Проверка, у которой
  // ответ один на любой адрес, не поймала бы ни возврата к «ставим везде», ни
  // ухода в «не ставим нигде» — а второе тихо ломает подписку.
  it('контроль: правило различает адреса, а не отвечает одинаково', () => {
    const yes = needsSignature(`${BASE}/rest/v1/rpc/player_index`);
    const no = needsSignature(`${BASE}/functions/v1/tg-pay`);
    expect(yes).not.toBe(no);
  });
});
