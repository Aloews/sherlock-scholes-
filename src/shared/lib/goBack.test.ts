// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { goBack } from './goBack';

describe('goBack', () => {
  it('идёт назад по истории, когда она есть', () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(3);
    const navigate = vi.fn();
    goBack(navigate as never);
    expect(navigate).toHaveBeenCalledWith(-1);
  });

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ, и он здесь главный: `navigate(-1)` при пустой
  // истории не делает НИЧЕГО, и кнопка выглядит сломанной. Так бывает у
  // карточки, открытой по прямой ссылке из Telegram.
  it('при пустой истории ведёт на главную, а не молчит', () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
    const navigate = vi.fn();
    goBack(navigate as never);
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('запасной путь можно задать', () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
    const navigate = vi.fn();
    goBack(navigate as never, '/profile');
    expect(navigate).toHaveBeenCalledWith('/profile');
  });
});
