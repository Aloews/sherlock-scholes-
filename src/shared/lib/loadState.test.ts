import { describe, it, expect, vi, afterEach } from 'vitest';
import { fromPostgrest, dataOr, ok, failed, LOADING, type LoadState } from './loadState';

// Смысл этого модуля — в РАЗЛИЧИИ между «пусто» и «сломалось». Поэтому тесты
// проверяют именно его: что успех с нулём строк не превращается в ошибку, а
// ошибка не превращается в пустой список.

afterEach(() => vi.restoreAllMocks());

const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});

describe('fromPostgrest', () => {
  it('успех с данными', () => {
    expect(fromPostgrest({ data: [1, 2], error: null }, 'x')).toEqual({ status: 'ok', data: [1, 2] });
  });

  it('успех БЕЗ строк — это ok, а не ошибка', () => {
    // Вся суть модуля. «За сутки ничего не вышло» — законный ответ, и экран
    // обязан отличать его от «не удалось загрузить».
    expect(fromPostgrest({ data: [], error: null }, 'x')).toEqual({ status: 'ok', data: [] });
  });

  it('null в данных читается как пусто, а не как поломка', () => {
    expect(fromPostgrest({ data: null, error: null }, 'x')).toEqual({ status: 'ok', data: [] });
  });

  it('ошибка сохраняет КОД, а не только факт', () => {
    // 42501 (нет прав) и PGRST202 (нет функции) — разные поломки с разными
    // причинами. За сессию оба встречались, и оба выглядели одинаково.
    quiet();
    expect(fromPostgrest({ data: null, error: { code: '42501', message: 'permission denied' } }, 'x'))
      .toEqual({ status: 'error', code: '42501' });
  });

  it('ошибка без кода не теряется', () => {
    quiet();
    expect(fromPostgrest({ data: null, error: { message: 'boom' } }, 'x'))
      .toEqual({ status: 'error', code: 'unknown' });
  });

  it('пишет в консоль, называя место', () => {
    const spy = quiet();
    fromPostgrest({ data: null, error: { code: '42501', message: 'permission denied' } }, 'digest_news');
    expect(spy).toHaveBeenCalledWith('[digest_news]', '42501', 'permission denied');
  });

  it('данные при ошибке игнорируются', () => {
    // PostgREST может вернуть и то и другое; доверять данным рядом с ошибкой
    // значит показать половину ответа как целый.
    quiet();
    const r = fromPostgrest({ data: [1], error: { code: 'X', message: 'm' } }, 'x');
    expect(r.status).toBe('error');
  });
});

describe('dataOr', () => {
  it('отдаёт данные, когда они есть', () => {
    expect(dataOr(ok([1, 2]), [])).toEqual([1, 2]);
  });

  it('отдаёт запасное на ошибке и на загрузке', () => {
    expect(dataOr(failed('42501') as LoadState<number[]>, [])).toEqual([]);
    expect(dataOr(LOADING as LoadState<number[]>, [])).toEqual([]);
  });
});
