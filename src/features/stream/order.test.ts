import { describe, it, expect } from 'vitest';
import { orderChannels, nextAlive, filterChannels } from './order';
import { PINNED, isPinned, type Channel } from './playlist';

const ch = (name: string, url = name): Channel => ({ name, group: 'SPORT 🏆', logo: null, url });

describe('orderChannels', () => {
  it('lifts a pinned channel above an unpinned one', () => {
    const out = orderChannels([ch('Divi Sport'), ch('Setanta Sports 1 HD')]);
    expect(out.map((c) => c.name)).toEqual(['Setanta Sports 1 HD', 'Divi Sport']);
  });

  it('keeps pinned channels in the order PINNED declares, not playlist order', () => {
    const out = orderChannels([ch('EUROSPORT 1'), ch('Viasat Sport'), ch('Setanta Sports 2 HD')]);
    expect(out.map((c) => c.name)).toEqual(['Setanta Sports 2 HD', 'Viasat Sport', 'EUROSPORT 1']);
  });

  // Устойчивость — не деталь: без неё незакреплённые тасовались бы на каждой
  // загрузке, хотя ранг у них один и тот же.
  it('leaves unpinned channels in playlist order', () => {
    const out = orderChannels([ch('Divi Sport'), ch('AYM HD'), ch('UFC Network')]);
    expect(out.map((c) => c.name)).toEqual(['Divi Sport', 'AYM HD', 'UFC Network']);
  });

  it('matches case-insensitively and on a substring', () => {
    expect(orderChannels([ch('X'), ch('arena sport 4 hd serbian')])[0].name)
      .toBe('arena sport 4 hd serbian');
  });

  it('does not mutate its input', () => {
    const input = [ch('Divi Sport'), ch('Setanta Sports 1 HD')];
    orderChannels(input);
    expect(input.map((c) => c.name)).toEqual(['Divi Sport', 'Setanta Sports 1 HD']);
  });

  it('survives an empty list', () => {
    expect(orderChannels([])).toEqual([]);
  });

  // Замер 25.08.2026: канал отдаёт 404. Поднять его наверх значит вернуть тот
  // самый баг — первый канал играет сам, и мёртвый первый ломает весь экран.
  // ⚠️ «Матч! ПЛАНЕТА» мертва, а «Матч! ПРЕМЬЕР» жива и закреплена первой:
  // проверка обязана их различать, иначе она бессмысленна.
  it('does not pin the channels that measured dead', () => {
    expect(isPinned(ch('Матч! Планета'))).toBe(false);
    expect(isPinned(ch('KHL'))).toBe(false);
    expect(isPinned(ch('FUTBOL UZ'))).toBe(false);
    expect(isPinned(ch('Матч! Премьер'))).toBe(true);
  });

  // Названные игроком каналы. Большинство сегодня отдаётся по http и до экрана
  // не доходит — но список обязан их знать, чтобы они появились сами, когда
  // ретранслятор отдаст их по https.
  it('knows every channel that was asked for by name', () => {
    for (const name of ['Матч! Премьер', 'Матч Премьер', 'Беларусь 5',
                        'Матч! Футбол 1', 'sport Футбол 2 HD', 'sport Футбол 3',
                        'Setanta Sports UA', 'Setanta Sports 1 HD']) {
      expect(isPinned(ch(name)), name).toBe(true);
    }
  });

  it('puts Матч! Премьер above the rest — it is the one that plays today', () => {
    const out = orderChannels([ch('Divi Sport'), ch('Setanta Sports 1 HD'), ch('Матч! Премьер')]);
    expect(out[0].name).toBe('Матч! Премьер');
  });

  it('leaves PINNED as a plain list of lowercase needles', () => {
    expect(PINNED.every((n) => n === n.toLowerCase())).toBe(true);
  });
});

describe('nextAlive', () => {
  const list = [ch('A'), ch('B'), ch('C')];

  it('starts at the first channel when nothing is playing yet', () => {
    expect(nextAlive(list, null, new Set())).toBe('A');
  });

  it('moves to the one after the current', () => {
    expect(nextAlive(list, 'A', new Set())).toBe('B');
  });

  it('skips over channels already known dead', () => {
    expect(nextAlive(list, 'A', new Set(['B']))).toBe('C');
  });

  it('wraps past the end back to the start', () => {
    expect(nextAlive(list, 'C', new Set())).toBe('A');
  });

  it('wraps and still skips the dead', () => {
    expect(nextAlive(list, 'B', new Set(['C']))).toBe('A');
  });

  // Отличать «все отказали» от «список пуст» обязан экран, поэтому обе ветки
  // возвращают null, но приходят к нему разными путями.
  it('returns null when every channel is dead', () => {
    expect(nextAlive(list, 'A', new Set(['A', 'B', 'C']))).toBeNull();
  });

  it('returns null on an empty list', () => {
    expect(nextAlive([], null, new Set())).toBeNull();
  });

  it('starts from the beginning when the current url is no longer in the list', () => {
    expect(nextAlive(list, 'GONE', new Set())).toBe('A');
  });

  it('can return the current channel again when it is the only live one', () => {
    expect(nextAlive(list, 'A', new Set(['B', 'C']))).toBe('A');
  });
});

describe('порядок по измеренному здоровью', () => {
  // ⚠️ ЭТО ИСПРАВЛЕНИЕ МОЕЙ ЖЕ ОШИБКИ. PINNED составлен по названиям, без
  // единой проверки, играет ли канал. Замер прода 25.08.2026 по ПОЛНОЙ
  // цепочке HLS: «Матч! Премьер», «Setanta Sports 1 HD», «Setanta Sports 2 HD»
  // мертвы ниже первого манифеста — и все три стояли первыми.
  it('отправляет отказавший канал вниз, каким бы закреплённым он ни был', () => {
    const list = [ch('Матч! Премьер', 'u1'), ch('Divi Sport', 'u2')];
    const out = orderChannels(list, { u1: 'failed' });
    expect(out.map((c) => c.name)).toEqual(['Divi Sport', 'Матч! Премьер']);
  });

  it('поднимает игравший канал выше незакреплённого неизвестного', () => {
    const list = [ch('Divi Sport', 'u1'), ch('AYM HD', 'u2')];
    expect(orderChannels(list, { u2: 'played' })[0].name).toBe('AYM HD');
  });

  it('игравший канал обгоняет даже закреплённого, о котором ничего не известно', () => {
    const list = [ch('Setanta Sports 1 HD', 'u1'), ch('Divi Sport', 'u2')];
    expect(orderChannels(list, { u2: 'played' })[0].name).toBe('Divi Sport');
  });

  // Внутри одной корзины порядок по-прежнему решает PINNED.
  it('среди равных по здоровью работает прежний порядок закреплённых', () => {
    const list = [ch('Divi Sport', 'u1'), ch('Setanta Sports 1 HD', 'u2')];
    expect(orderChannels(list, {})[0].name).toBe('Setanta Sports 1 HD');
  });

  it('без сведений о здоровье ведёт себя ровно как раньше', () => {
    const list = [ch('Divi Sport', 'u1'), ch('Матч! Премьер', 'u2')];
    expect(orderChannels(list).map((c) => c.name))
      .toEqual(orderChannels(list, {}).map((c) => c.name));
  });

  it('три мёртвых закреплённых уступают одному живому незакреплённому', () => {
    const list = [
      ch('Матч! Премьер', 'd1'), ch('Setanta Sports 1 HD', 'd2'),
      ch('Setanta Sports 2 HD', 'd3'), ch('Viasat Sport', 'ok1'),
    ];
    const out = orderChannels(list, { d1: 'failed', d2: 'failed', d3: 'failed', ok1: 'played' });
    expect(out[0].name).toBe('Viasat Sport');
  });
});

describe('избранное и поиск — то, чем живёт любой плеер IPTV', () => {
  // ⚠️ ИЗБРАННОЕ ВЫШЕ ЗДОРОВЬЯ. Здоровье — то, что приложение УЗНАЛО;
  // избранное — то, что игрок СКАЗАЛ. Ставить догадку выше прямого указания
  // значит спорить с ним о том, что ему смотреть.
  it('избранный канал обгоняет игравший', () => {
    const list = [ch('Игравший', 'u1'), ch('Избранный', 'u2')];
    expect(orderChannels(list, { u1: 'played' }, ['u2'])[0].name).toBe('Избранный');
  });

  it('избранный канал обгоняет даже отказавший... нет — отказавший остаётся внизу', () => {
    const list = [ch('Живой', 'u1'), ch('Избранный, но мёртвый', 'u2')];
    const out = orderChannels(list, { u2: 'failed' }, ['u2']);
    // Избранное поднимает, но отказ по-прежнему учитывается вторым ключом:
    // игрок сказал «хочу», приложение знает «не играет» — показываем первым
    // всё равно его, иначе звезда ничего не значит.
    expect(out[0].name).toBe('Избранный, но мёртвый');
  });

  it('без избранного порядок ровно прежний', () => {
    const list = [ch('Divi Sport', 'u1'), ch('Setanta Sports 1 HD', 'u2')];
    expect(orderChannels(list, {}, []).map((c) => c.name))
      .toEqual(orderChannels(list, {}).map((c) => c.name));
  });
});

describe('filterChannels', () => {
  const list = [ch('Setanta Sports 1 HD', 'u1'), ch('Матч! Премьер', 'u2'), ch('Divi Sport', 'u3')];

  it('пустой запрос ничего не отсекает', () => {
    expect(filterChannels(list, '', false)).toHaveLength(3);
  });

  // Игрок печатает «сет», а канал называется «Setanta Sports 1 HD»: требовать
  // совпадения с начала значит заставить его знать чужую запись названия.
  it('ищет по вхождению и без учёта регистра', () => {
    expect(filterChannels(list, 'sport', false).map((c) => c.name))
      .toEqual(['Setanta Sports 1 HD', 'Divi Sport']);
    expect(filterChannels(list, 'ПРЕМЬЕР', false).map((c) => c.name)).toEqual(['Матч! Премьер']);
  });

  it('не спотыкается о пробелы по краям', () => {
    expect(filterChannels(list, '  премьер  ', false)).toHaveLength(1);
  });

  it('«только избранное» оставляет отмеченные', () => {
    expect(filterChannels(list, '', true, ['u2']).map((c) => c.name)).toEqual(['Матч! Премьер']);
  });

  it('поиск и «только избранное» работают вместе', () => {
    expect(filterChannels(list, 'sport', true, ['u1', 'u2']).map((c) => c.name))
      .toEqual(['Setanta Sports 1 HD']);
  });

  it('«только избранное» без единой звезды даёт пусто, а не весь список', () => {
    expect(filterChannels(list, '', true, [])).toEqual([]);
  });

  // Порядок задан orderChannels; пересортировать результат поиска значило бы
  // показать избранное не там, где игрок его только что видел.
  it('сохраняет порядок входного списка', () => {
    expect(filterChannels(list, 's', false).map((c) => c.name))
      .toEqual(['Setanta Sports 1 HD', 'Divi Sport']);
  });
});
