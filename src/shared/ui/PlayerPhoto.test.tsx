// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { PlayerPhoto } from './PlayerPhoto';

/**
 * МЕТКА ДОЛЖНА ДОЕХАТЬ ДО DOM, А НЕ ОСТАТЬСЯ В ИСХОДНИКЕ.
 *
 * ⚠️ СОСЕДНЯЯ ПРОВЕРКА (`test/provenance_coverage.test.ts`) ЧИТАЕТ ТЕКСТ
 * ФАЙЛОВ, И ЭТОГО МАЛО. Она увидит вызов `provenanceAttrs`, но не заметит,
 * что результат не разложен в атрибуты, что React выбросил их как неизвестные
 * или что функция вернула пустоту. Невидимая маркировка тем и опасна, что её
 * отсутствие нельзя заметить глазами: единственный способ убедиться — прочесть
 * готовый DOM.
 *
 * Ровно по этой причине в проекте существует `check-prod`: проверка, которая
 * останавливается раньше конца цепочки, называет живым то, что не работает.
 */
afterEach(cleanup);

describe('метка источника у фото карточки', () => {
  it('доезжает до атрибутов готового элемента', () => {
    const { container } = render(
      <PlayerPhoto src="https://commons.wikimedia.org/wiki/Special:FilePath/X.jpg?width=256" />,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('data-origin')).toBe('wikimedia_commons');
  });

  it('различает источники, а не ставит одну метку всем', () => {
    // Отрицательный контроль: метка, одинаковая у всех, не значит ничего.
    const { container } = render(
      <PlayerPhoto src="https://img.a.transfermarkt.technology/portrait/big/1-2.png" />,
    );
    expect(container.querySelector('img')!.getAttribute('data-origin'))
      .toBe('transfermarkt');
  });

  it('незнакомый хост остаётся БЕЗ метки, а не с выдуманной', () => {
    // Атрибут со значением «неизвестно» утверждал бы, что мы спрашивали.
    const { container } = render(<PlayerPhoto src="https://example.invalid/x.jpg" />);
    expect(container.querySelector('img')!.hasAttribute('data-origin')).toBe(false);
  });

  it('фото на месте и кадрирование не тронуто', () => {
    // Маркировка не имеет права ничего менять на экране — это её смысл.
    const { container } = render(
      <PlayerPhoto src="https://commons.wikimedia.org/wiki/Special:FilePath/X.jpg" alt="Месси" />,
    );
    const img = container.querySelector('img')!;
    expect(img.getAttribute('alt')).toBe('Месси');
    expect(img.className).not.toBe('');
  });
});
