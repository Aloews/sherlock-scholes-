import { describe, it, expect } from 'vitest';
import { storyTokens, overlap, SAME_STORY_TOKENS } from './storyTokens';

// ⚠️ ЭТАЛОН ВЗЯТ С БОЕВОГО СЕРВЕРА, А НЕ ПРИДУМАН.
//
// Пары ниже — вывод `select title, digest_tokens(title) from news_items`
// по случайным живым заголовкам. Смысл теста ровно один: доказать, что
// клиентский порт считает ТО ЖЕ, что Postgres. Разойдутся — и на экране
// рядом встанут «5 изданий» от сервера и три склеенные карточки от клиента,
// причём заметит это только человек с калькулятором.
//
// Заголовки нарочно разноязычные: именно на транслитерации порт и мог бы
// разойтись — кириллица, диакритика, ç/ñ, ligature-подобные ch/ш.
const FIXTURES: Array<[string, string[]]> = [
  ['Дмитрий Черышев: с первых матчей можно сказать, что «Спартак» будет биться за чемпионство',
   ['bitsi','budet','dmitr','matsh','mozhn','pervy','shemp','shery','skaza','spart']],
  ['Ethiopia bids to host 2028 Afcon despite having only one approved stadium',
   ['afson','appro','bids','despi','ethio','havin','host','only','stadi']],
  ['Aarhus a mexer: Jensen-Abbew deixa o clube e ruma à Holanda',
   ['aarhu','abbew','deixa','holan','iense','mexer','ruma','slube']],
  ['Fichajes, maletas y sensaciones', ['fisha','malet','sensa']],
  ['Dalglish and Carney win PFA Merit Awards', ['award','dalgl','merit','sarne']],
  ['Football transfer rumours: Manchester City and Spurs chase Cody Gakpo?',
   ['footb','gakpo','mansh','rumou','shase','sity','sody','spurs','trans']],
  ['«Игрок и его представители — идиоты». Дюгарри раскритиковал Хулиана Альвареса',
   ['alvar','diuga','hulia','idiot','igrok','preds','raskr']],
  ['Torino : un club de Ligue 2 a tenté de recruter Pietro Pellegri',
   ['ligue','pelle','pietr','resru','slub','tente','torin']],
  ['O momento em que ciclistas da Volta a Espanha procuram abrigar-se de tempestade de granizo',
   ['abrig','espan','grani','momen','prosu','sisli','tempe','volta']],
  ['PSG : Ousmane Dembélé a été lourdement puni selon Daniel Riolo',
   ['danie','dembe','lourd','ousma','puni','riolo','selon']],
  ['Charla arbitral a la plantilla del Barça', ['arbit','barsa','plant','sharl']],
  ['Mourinho y sus dos teorías sobre Vinicius', ['mouri','sobre','teori','vinis']],
];

describe('storyTokens — порт digest_tokens', () => {
  for (const [title, expected] of FIXTURES) {
    it(`совпадает с сервером: ${title.slice(0, 42)}…`, () => {
      expect([...storyTokens(title)].sort()).toEqual([...expected].sort());
    });
  }
});

describe('склейка сюжетов', () => {
  // Тот самый сюжет, из-за которого лента и выглядела повторяющейся: пять
  // заголовков на четырёх языках об одном трансфере.
  const DELAP = [
    "Chelsea's Liam Delap set for £50M Nottingham Forest move",
    '«Ноттингем Форест» договорился о трансфере нападающего «Челси» Делапа',
    'Delap heads to Forest for £50m as Chelsea open talks',
    'Forest agree £50m deal for Chelsea striker Delap',
    'Forest agree club-record deal for Chelsea’s Delap',
  ];

  it('английские заголовки об одном трансфере пересекаются по порогу', () => {
    const toks = DELAP.map(storyTokens);
    // Английские четыре — между собой.
    for (let i = 2; i < toks.length; i += 1) {
      expect(overlap(toks[i], toks[2])).toBeGreaterThanOrEqual(SAME_STORY_TOKENS);
    }
  });

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ. Без него «склейка» прошла бы и у функции,
  // которая объявляет одним сюжетом ВСЁ подряд, — а это хуже повторов:
  // разные новости слиплись бы в одну карточку и часть просто исчезла.
  it('разные сюжеты НЕ пересекаются по порогу', () => {
    const a = storyTokens('Forest agree £50m deal for Chelsea striker Delap');
    const b = storyTokens('Mourinho y sus dos teorías sobre Vinicius');
    const c = storyTokens('Ethiopia bids to host 2028 Afcon despite having only one approved stadium');
    expect(overlap(a, b)).toBeLessThan(SAME_STORY_TOKENS);
    expect(overlap(a, c)).toBeLessThan(SAME_STORY_TOKENS);
    expect(overlap(b, c)).toBeLessThan(SAME_STORY_TOKENS);
  });
});
