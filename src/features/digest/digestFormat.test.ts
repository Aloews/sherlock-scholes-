import { describe, it, expect } from 'vitest';
import { watchUrl, feedLanguage } from './digestFormat';

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
