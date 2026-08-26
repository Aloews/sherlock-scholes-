import { describe, it, expect } from 'vitest';
import { groupStories } from './groupStories';
import type { NewsItem } from './digestApi';

const note = (over: Partial<NewsItem> & { title: string; source: string }): NewsItem => ({
  url: `https://example.test/${encodeURIComponent(over.title)}`,
  lang: 'en',
  published_at: '2026-08-26T05:00:00Z',
  image_url: null,
  loudness: 1,
  summary_short: null,
  ...over,
});

// Тот самый сюжет, ради которого склейка и делалась: один трансфер печатался
// в ленте пятью строками подряд.
const DELAP: NewsItem[] = [
  note({ title: "Chelsea's Liam Delap set for £50M Nottingham Forest move", source: 'ESPN' }),
  note({ title: 'Delap heads to Forest for £50m as Chelsea open talks', source: 'The Guardian' }),
  note({ title: 'Forest agree £50m deal for Chelsea striker Delap', source: 'BBC Sport' }),
  note({ title: 'Forest agree club-record deal for Chelsea striker Delap', source: 'Sky Sports' }),
];

describe('groupStories', () => {
  it('склеивает пять строк об одном трансфере в один сюжет', () => {
    const stories = groupStories(DELAP, 'en');
    expect(stories).toHaveLength(1);
    expect(stories[0].sourceCount).toBe(4);
    expect(stories[0].alsoSources).toHaveLength(3);
  });

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ, и он важнее предыдущего. Без него склейка
  // прошла бы и у функции, объявляющей одним сюжетом ВСЁ подряд, — а это хуже
  // повторов: разные новости слиплись бы в одну карточку, и часть ленты
  // просто исчезла бы с экрана.
  it('разные сюжеты остаются РАЗНЫМИ карточками', () => {
    const mixed = [
      ...DELAP,
      note({ title: 'Mourinho y sus dos teorías sobre Vinicius', source: 'Marca', lang: 'es' }),
      note({ title: 'Ethiopia bids to host 2028 Afcon despite having only one approved stadium', source: 'BBC Sport' }),
    ];
    const stories = groupStories(mixed, 'en');
    expect(stories).toHaveLength(3);
    expect(stories.map((s) => s.sourceCount).sort()).toEqual([1, 1, 4]);
  });

  it('ни одна заметка не теряется и не двоится', () => {
    const mixed = [
      ...DELAP,
      note({ title: 'Mourinho y sus dos teorías sobre Vinicius', source: 'Marca' }),
    ];
    const stories = groupStories(mixed, 'en');
    const total = stories.reduce((n, s) => n + 1 + s.alsoSources.length, 0);
    // Пять заметок от пяти РАЗНЫХ изданий: ведущие плюс упомянутые = пять.
    expect(total).toBe(5);
  });

  it('ведущей выбирается заметка на языке читателя, а не первая', () => {
    // ⚠️ Заголовки взяты ЦЕЛИКОМ с боевой ленты, а не сокращены. Укороченная
    // русская версия («Форест договорился о трансфере Делапа») пересекается с
    // английской всего по двум основам — fores и delap, — то есть НЕ проходит
    // порог в три и в один сюжет не склеивается. Первая редакция этого теста
    // на том и упала: сокращение фикстуры незаметно меняет то, что проверяешь.
    const group = [
      note({ title: "Chelsea's Liam Delap set for £50M Nottingham Forest move",
             source: 'BBC Sport', lang: 'en' }),
      note({ title: '«Ноттингем Форест» договорился о трансфере нападающего «Челси» Делапа',
             source: 'Чемпионат', lang: 'ru' }),
    ];
    // Сначала убеждаемся, что сюжет ОДИН: иначе проверка ниже сравнивала бы
    // ведущих двух разных сюжетов и проходила бы по случайности.
    expect(groupStories(group, 'ru')).toHaveLength(1);
    // На русском ведущей обязана стать русская, даже стоя второй.
    expect(groupStories(group, 'ru')[0].lead.source).toBe('Чемпионат');
    // И симметрично: англичанину — английская.
    expect(groupStories(group, 'en')[0].lead.source).toBe('BBC Sport');
  });

  it('при равном языке ведущей становится заметка С КАРТИНКОЙ', () => {
    const group = [
      note({ title: 'Forest agree £50m deal for Chelsea striker Delap', source: 'BBC Sport' }),
      note({ title: 'Forest agree club-record deal for Chelsea striker Delap',
             source: 'Sky Sports', image_url: 'https://example.test/p.jpg' }),
    ];
    expect(groupStories(group, 'en')[0].lead.source).toBe('Sky Sports');
  });

  it('пустая лента даёт пустой список, а не падение', () => {
    expect(groupStories([], 'ru')).toEqual([]);
  });
});

// ⚠️ РЕГРЕССИЯ НА НАСТОЯЩУЮ ПОЛОМКУ, а не на выдуманную.
//
// Первая версия склеивала связными компонентами: «A похожа на B, B на C —
// значит все трое об одном». Похожесть заголовков НЕ транзитивна, и на живой
// ленте эта цепочка стянула ДВАДЦАТЬ заметок из шестидесяти в одну карточку —
// Селтик с ЛАСКом, Будё-Глимт с НЕКом, Сабах с Хапоэлем и «Бетис» с
// «Валенсией» из другого турнира. Совпадали не события, а футбольный словарь.
//
// Заголовки ниже — те самые, на которых это и вылезло.
describe('регрессия: разные матчи не сливаются через общий словарь', () => {
  const REAL = [
    note({ title: 'Celtic blow four-goal lead to LASK, crash out of Champions League', source: 'ESPN' }),
    note({ title: 'Celtic throw away four-goal lead to crash out of Champions League', source: 'The Guardian' }),
    note({ title: '«Буде-Глимт» разгромил НЕК и вышел в общий этап Лиги чемпионов',
           source: 'Спорт-Экспресс', lang: 'ru' }),
    note({ title: '«Сабах» — второй азербайджанский клуб в истории, вышедший в общий этап',
           source: 'Чемпионат', lang: 'ru' }),
    note({ title: '«Бетис» победил «Валенсию» в матче 1-го тура Ла Лиги благодаря голу в концовке',
           source: 'Чемпионат', lang: 'ru' }),
  ];

  it('пять разных событий не превращаются в один сюжет', () => {
    const stories = groupStories(REAL, 'ru');
    // Два английских про Селтик — законно вместе. Остальные три — врозь.
    expect(stories.length).toBeGreaterThanOrEqual(4);
    const biggest = Math.max(...stories.map((s) => 1 + s.alsoSources.length));
    expect(biggest).toBeLessThanOrEqual(2);
  });

  it('«Бетис» — «Валенсия» не попадает в сюжет про Лигу чемпионов', () => {
    const stories = groupStories(REAL, 'ru');
    const betis = stories.find((s) => s.lead.title.includes('Бетис'));
    expect(betis).toBeDefined();
    // Матч Ла Лиги обязан стоять сам по себе: с ЛЧ его роднит только слово
    // «матче», а это словарь, а не событие.
    expect(betis?.alsoSources).toHaveLength(0);
  });
});
