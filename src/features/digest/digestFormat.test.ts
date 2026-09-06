import { describe, it, expect } from 'vitest';
import { watchUrl, feedLanguage, plainText } from './digestFormat';

// Обе функции стоят между «экран показывает то» и «экран показывает не то, но
// выглядит рабочим». Остальная логика дайджеста — кластеризация заголовков по
// громкости — живёт в SQL (digest_news) и проверена на живых данных.

describe('watchUrl', () => {
  it('строит ссылку из идентификатора, который лежит в базе', () => {
    expect(watchUrl({ video_id: 'gCkzMZeXjoE' }))
      .toBe('https://www.youtube.com/watch?v=gCkzMZeXjoE');
  });
});

describe('feedLanguage', () => {
  it('оставляет двухбуквенный код как есть', () => {
    expect(feedLanguage('ru')).toBe('ru');
  });

  // «ru-RU» не совпал бы ни с одной строкой в базе, и читатель получил бы
  // чистый английский на экране, который при этом работает.
  it('срезает регион', () => {
    expect(feedLanguage('ru-RU')).toBe('ru');
    expect(feedLanguage('pt-BR')).toBe('pt');
    expect(feedLanguage('zh-Hans-CN')).toBe('zh');
  });

  it('приводит к нижнему регистру', () => {
    expect(feedLanguage('EN')).toBe('en');
  });

  // Язык может быть ещё не определён на первом рендере.
  it('без языка просит английский', () => {
    expect(feedLanguage('')).toBe('en');
  });
});

/**
 * Разметка в сути — замер живой ленты 06.09.2026: 540 заметок на девяти
 * языках, суть у 362, тег встретился в 27 и ровно один — `<p>`, у The
 * Guardian. React печатает такую строку как текст, поэтому в ленте читалось
 * «<p>True redemption, perhaps…» вместе с тегом.
 */
describe('plainText', () => {
  it('снимает абзац Guardian, из-за которого тег читался как текст', () => {
    expect(plainText('<p>True redemption, perhaps, would have been to score with a Panenka'))
      .toBe('True redemption, perhaps, would have been to score with a Panenka');
  });

  it('пусто на месте пусто', () => {
    expect(plainText(null)).toBe('');
    expect(plainText(undefined)).toBe('');
  });

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: чистая строка обязана дойти до экрана слово в
  // слово. Проверка «нет тегов» прошла бы и у функции, стирающей всё подряд.
  it('текст без разметки не трогается', () => {
    const text = 'Enzo le Fee converted a late penalty to earn Sunderland a draw at Brentford.';
    expect(plainText(text)).toBe(text);
  });

  it('на месте тега остаётся пробел, а не склейка слов', () => {
    expect(plainText('Первый абзац.<br>Второй абзац.')).toBe('Первый абзац. Второй абзац.');
  });
});
