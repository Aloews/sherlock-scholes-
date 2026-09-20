import { describe, expect, it } from 'vitest';
import { compareLeaguesByValue, type LeagueValue } from './leagueOrder';

const v = (
  sport_key: string, squad_value_eur: number | null, clubs: number, pinned: number,
): LeagueValue => ({ sport_key, squad_value_eur, clubs, pinned });

/** Порядок ключей после сортировки — то, что увидит игрок в ряду чипов. */
function order(keys: string[], rows: LeagueValue[]): string[] {
  const map = new Map(rows.map((r) => [r.sport_key, r]));
  return [...keys].sort((a, b) => compareLeaguesByValue(a, b, map));
}

describe('порядок турниров на экране матчей', () => {
  it('шесть закреплённых идут перед всеми, даже если они беднее', () => {
    // Живые числа, замер 20.09.2026: медиана состава в млн евро.
    const rows = [
      v('soccer_spain_la_liga', 169e6, 15, 1),
      v('soccer_uefa_champs_league', 485e6, 23, 0),
      v('soccer_epl', 575e6, 18, 1),
    ];
    expect(order(rows.map((r) => r.sport_key), rows)).toEqual([
      'soccer_epl', 'soccer_spain_la_liga', 'soccer_uefa_champs_league',
    ]);
  });

  it('незакреплённые — по убыванию стоимости', () => {
    const rows = [
      v('soccer_mexico_ligamx', 63e6, 7, 0),
      v('soccer_uefa_champs_league', 485e6, 23, 0),
      v('soccer_brazil_campeonato', 114e6, 6, 0),
    ];
    expect(order(rows.map((r) => r.sport_key), rows)).toEqual([
      'soccer_uefa_champs_league', 'soccer_brazil_campeonato', 'soccer_mexico_ligamx',
    ]);
  });

  it('число матчей БОЛЬШЕ не решает порядок', () => {
    // Ровно та поломка, ради которой правило и менялось: у второго дивизиона
    // плотный тур, и по счётчику он стоял выше Ла Лиги. Счётчик сюда не
    // передаётся вовсе — и это проверяется тем, что порядок от него не зависит.
    const rows = [
      v('soccer_spain_la_liga', 169e6, 15, 1),
      v('soccer_some_second_tier', 12e6, 20, 0),
    ];
    expect(order(['soccer_some_second_tier', 'soccer_spain_la_liga'], rows))
      .toEqual(['soccer_spain_la_liga', 'soccer_some_second_tier']);
  });

  it('турнир без стоимости уходит в конец, но НЕ пропадает', () => {
    // Провайдер заводит ключ при старте турнира, и до первой ночной сверки
    // стоимости у него нет. Пропавший чип читается как «матчей нет».
    const rows = [
      v('soccer_mexico_ligamx', 63e6, 7, 0),
      v('soccer_brand_new_cup', null, 0, 0),
    ];
    expect(order(['soccer_brand_new_cup', 'soccer_mexico_ligamx'], rows))
      .toEqual(['soccer_mexico_ligamx', 'soccer_brand_new_cup']);
  });

  it('турнира нет в ответе RPC — тоже в конец, а не исключение', () => {
    const rows = [v('soccer_epl', 575e6, 18, 1)];
    expect(order(['soccer_unknown_key', 'soccer_epl'], rows))
      .toEqual(['soccer_epl', 'soccer_unknown_key']);
  });

  it('при полном равенстве порядок устойчив, а не дрожит', () => {
    // Дрожание между отрисовками — это чипы, прыгающие под пальцем.
    const rows = [v('b_key', 10e6, 2, 0), v('a_key', 10e6, 2, 0)];
    expect(order(['b_key', 'a_key'], rows)).toEqual(['a_key', 'b_key']);
    expect(order(['a_key', 'b_key'], rows)).toEqual(['a_key', 'b_key']);
  });

  it('РПЛ закреплена — она вернётся из перерыва и должна встать вперёд', () => {
    // Замер 20.09.2026: у РПЛ ноль предстоящих матчей (перерыв до 9 октября),
    // поэтому её нет в ответе RPC. Проверяется именно возвращение.
    const rows = [
      v('soccer_russia_premier_league', 40e6, 16, 1),
      v('soccer_uefa_champs_league', 485e6, 23, 0),
    ];
    expect(order(rows.map((r) => r.sport_key), rows)).toEqual([
      'soccer_russia_premier_league', 'soccer_uefa_champs_league',
    ]);
  });
});
