// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearRoom, readRoom, writeRoom, ROOM_TTL_MS } from './arenaSession';

/**
 * Половина этих проверок — про ЧУЖОЙ ввод, и это не паранойя.
 *
 * Запись делаем мы, но читаем её из localStorage: туда лезут расширения, её
 * переживает выкатка версии с другим форматом, и до неё дотягивается любой
 * скрипт на странице. Роль «h» вместо «host» отправила бы гостя считать физику
 * на своём телефоне, а код с посторонними символами ушёл бы в имя канала
 * Realtime. Поэтому мусор проверяется наравне с обычным случаем.
 */
describe('arenaSession', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('возвращает записанную комнату', () => {
    writeRoom({ code: 'AB12CD', role: 'host' }, 1000);
    expect(readRoom(1000)).toEqual({ code: 'AB12CD', role: 'host' });
  });

  it('без записи отдаёт null, а не пустую комнату', () => {
    expect(readRoom(1000)).toBeNull();
  });

  it('забывает комнату, из которой вышли сами', () => {
    writeRoom({ code: 'AB12CD', role: 'guest' }, 1000);
    clearRoom();
    expect(readRoom(1000)).toBeNull();
  });

  // ── Срок жизни ────────────────────────────────────────────────────────────
  // Граница проверяется с обеих сторон: «в пределах» и «за пределом». Тест
  // только на одну из них прошёл бы и при перепутанном знаке сравнения.

  it('держит комнату весь срок', () => {
    writeRoom({ code: 'AB12CD', role: 'host' }, 0);
    expect(readRoom(ROOM_TTL_MS)).toEqual({ code: 'AB12CD', role: 'host' });
  });

  it('забывает комнату сразу за сроком', () => {
    writeRoom({ code: 'AB12CD', role: 'host' }, 0);
    expect(readRoom(ROOM_TTL_MS + 1)).toBeNull();
  });

  it('отвергает запись из будущего: часы уехали, и возраст не оценить', () => {
    writeRoom({ code: 'AB12CD', role: 'host' }, 10_000);
    expect(readRoom(9_000)).toBeNull();
  });

  // ── Мусор ─────────────────────────────────────────────────────────────────

  it('переживает не-JSON в ключе', () => {
    localStorage.setItem('arena.room', 'не json');
    expect(readRoom(1000)).toBeNull();
  });

  it('переживает JSON не того вида', () => {
    localStorage.setItem('arena.room', '"строка"');
    expect(readRoom(1000)).toBeNull();
    localStorage.setItem('arena.room', 'null');
    expect(readRoom(1000)).toBeNull();
    localStorage.setItem('arena.room', '[1,2,3]');
    expect(readRoom(1000)).toBeNull();
  });

  it('отвергает роль, которой нет', () => {
    localStorage.setItem('arena.room', JSON.stringify({ code: 'AB12CD', role: 'h', at: 1000 }));
    expect(readRoom(1000)).toBeNull();
    localStorage.setItem('arena.room', JSON.stringify({ code: 'AB12CD', role: 'admin', at: 1000 }));
    expect(readRoom(1000)).toBeNull();
    localStorage.setItem('arena.room', JSON.stringify({ code: 'AB12CD', at: 1000 }));
    expect(readRoom(1000)).toBeNull();
  });

  it('отвергает код не той формы — той же проверкой, что и ввод с экрана', () => {
    for (const code of ['AB12C', 'AB12CDE', 'ab12c!', '', 'AB 12C']) {
      localStorage.setItem('arena.room', JSON.stringify({ code, role: 'host', at: 1000 }));
      expect(readRoom(1000), `код ${JSON.stringify(code)} не должен пройти`).toBeNull();
    }
  });

  it('приводит код к верхнему регистру, как это делает поле ввода', () => {
    localStorage.setItem('arena.room', JSON.stringify({ code: 'ab12cd', role: 'guest', at: 1000 }));
    expect(readRoom(1000)).toEqual({ code: 'AB12CD', role: 'guest' });
  });

  it('отвергает запись без отметки времени: без неё срок не проверить', () => {
    localStorage.setItem('arena.room', JSON.stringify({ code: 'AB12CD', role: 'host' }));
    expect(readRoom(1000)).toBeNull();
    localStorage.setItem('arena.room', JSON.stringify({ code: 'AB12CD', role: 'host', at: 'вчера' }));
    expect(readRoom(1000)).toBeNull();
  });
});
