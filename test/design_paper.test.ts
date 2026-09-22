import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DESIGN_IDS, DESIGNS } from '../src/shared/design/designs';

/**
 * ТРЕТИЙ ДИЗАЙН — СВЕТЛЫЙ, И ИМЕННО ПОЭТОМУ ОН ЛОМАЕТСЯ ТИХО.
 *
 * Пока дизайнов было два и оба тёмных, забытый токен ничем себя не проявлял:
 * значение подхватывалось из `:root` и выглядело так же. С кремовой бумагой
 * любой забытый токен — это тёмное пятно на светлом или, хуже, невидимый
 * текст: белое по кремовому не видно вовсе, а заметить это можно только
 * глазами и только на том экране, куда дошёл.
 *
 * Поэтому здесь проверяется не «блок есть», а три способа развалиться:
 *
 *   1. в новом блоке не хватает токена, который есть у старых;
 *   2. список дизайнов выписан ВТОРОЙ раз — в `index.html`, до единой строчки
 *      JS, — и разошёлся с DESIGN_IDS;
 *   3. цвета заставки выписаны ТРЕТИЙ раз, там же, и разошлись с токенами.
 */

const CSS = readFileSync('src/index.css', 'utf8');
const HTML = readFileSync('index.html', 'utf8');

/** Тело блока дизайна из @layer base. */
function block(selector: string): string {
  const i = CSS.indexOf(selector);
  expect(i, `блок ${selector} не найден`).toBeGreaterThanOrEqual(0);
  const from = CSS.indexOf('{', i);
  const to = CSS.indexOf('\n  }', from);
  expect(to).toBeGreaterThan(from);
  return CSS.slice(from, to);
}

/** Имена переменных, объявленных в блоке. */
function tokens(selector: string): Set<string> {
  return new Set([...block(selector).matchAll(/^\s*(--[a-z-]+):/gm)].map((m) => m[1]));
}

describe('бумажный дизайн', () => {
  it('заведён в реестре и объявляет себя светлым', () => {
    expect(DESIGN_IDS).toContain('paper');
    expect(DESIGNS.paper.scheme).toBe('light');
    // Остальные два обязаны остаться тёмными: если светлым объявят всё,
    // проверка выше перестанет что-либо значить.
    expect(DESIGNS.master.scheme).toBe('dark');
    expect(DESIGNS.classic.scheme).toBe('dark');
  });

  it('объявляет ВСЕ токены, какие есть у тёмных дизайнов', () => {
    // ⚠️ ЗАБЫТЫЙ ТОКЕН НЕ ПАДАЕТ — ОН НАСЛЕДУЕТСЯ ИЗ :root. То есть на
    // кремовой странице окажется значение, подобранное под почти чёрный фон,
    // и увидит это только человек, дошедший до нужного экрана.
    const classic = tokens(":root,\n  [data-design='classic']");
    const paper = tokens("[data-design='paper']");
    const missing = [...classic].filter((t) => !paper.has(t));
    expect(missing, 'в бумажном блоке не хватает токенов').toEqual([]);
  });

  it('цвет текста уведён с белого — иначе светлый дизайн невозможен', () => {
    expect(block("[data-design='paper']")).toMatch(/--brand-fg:\s+30 27 22/);
    // И у тёмных он остался белым, иначе перекрасился бы весь интерфейс.
    expect(block(":root,\n  [data-design='classic']")).toMatch(/--brand-fg:\s+255 255 255/);
    expect(block("[data-design='master']")).toMatch(/--brand-fg:\s+255 255 255/);
  });

  it('body и поля ввода идут за токеном, а не за text-white', () => {
    // Ровно эти две строки делали светлый дизайн невозможным.
    expect(CSS).not.toMatch(/body \{[^}]*@apply[^;]*text-white/);
    expect(CSS).toMatch(/body \{[\s\S]{0,120}color: rgb\(var\(--brand-fg\)\)/);
  });

  it('у каждого дизайна свои цвета редкости', () => {
    // `icon` — #F4EEE6, почти белый: на кремовом он исчезает целиком, и это
    // не полировка, а пропавшая карточка высшего тира.
    for (const sel of [":root,\n  [data-design='classic']", "[data-design='master']",
                       "[data-design='paper']"]) {
      for (const t of ['icon', 'legendary', 'epic', 'rare', 'common']) {
        expect(block(sel), `${sel}: нет --tier-${t}`).toMatch(new RegExp(`--tier-${t}:`));
      }
    }
    // И смотреть надо на ЗНАЧЕНИЕ, а не на текст блока: про #F4EEE6 там же
    // написано в комментарии, и поиск по подстроке краснел бы на объяснении
    // того, почему этого цвета здесь нет.
    const paperIcon = /--tier-icon:\s*(#[0-9A-Fa-f]{6})/.exec(block("[data-design='paper']"));
    expect(paperIcon, 'в бумажном блоке нет --tier-icon').not.toBeNull();
    expect(paperIcon![1].toUpperCase(), 'на кремовом #F4EEE6 не виден вовсе')
      .not.toBe('#F4EEE6');
  });
});

describe('оболочка до первого кадра', () => {
  // ⚠️ ЭТО ВТОРАЯ И ТРЕТЬЯ КОПИИ ОДНИХ И ТЕХ ЖЕ ЗНАНИЙ. `index.html` рисуется
  // ДО единой строчки JS и до внешнего CSS: ни DESIGN_IDS, ни токены ему
  // недоступны, и список дизайнов со цветами заставки выписан там руками.
  // Разойдутся — человек с бумажным дизайном увидит тёмный экран на КАЖДОЙ
  // загрузке, а потом вспышку в светлый. Ошибка живёт только в первые
  // полсекунды и на скриншот не попадает.
  it('список дизайнов в index.html совпадает с DESIGN_IDS', () => {
    const m = /var known = \[([^\]]*)\]/.exec(HTML);
    expect(m, 'в index.html больше нет списка дизайнов — тест надо переписать')
      .not.toBeNull();
    const listed = [...m![1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
    expect(listed.sort()).toEqual([...DESIGN_IDS].sort());
  });

  it('цвета заставки совпадают с токенами бумажного блока', () => {
    const paper = block("[data-design='paper']");
    const bg = /--brand-bg:\s+(\d+) (\d+) (\d+)/.exec(paper)!;
    const fg = /--brand-fg:\s+(\d+) (\d+) (\d+)/.exec(paper)!;
    const hex = (m: RegExpExecArray) =>
      '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('');
    expect(HTML).toContain(`--splash-bg: ${hex(bg)}`);
    expect(HTML).toContain(`--splash-ink: ${hex(fg)}`);
  });

  it('встроенный фон body НЕ прибит к тёмному', () => {
    // ⚠️ ИМЕННО ЭТО ДЕРЖАЛО СТРАНИЦУ ТЁМНОЙ, И НАШЛОСЬ НЕ ГЛАЗАМИ. У body
    // рядом стоит `class="bg-brand-bg"`, который уже читал токен и давал
    // кремовый, — но `style="background: #0a0e1a"` перебивал его по правилам
    // каскада. Замер computed-стиля в настоящем браузере: --brand-bg =
    // 242 234 219, а body = rgb(10,14,26). Ни один тест по исходникам такого
    // не заметил бы: обе строки выглядят осмысленно порознь.
    const body = /<body[^>]*>/.exec(HTML);
    expect(body, 'тега body нет — тест надо переписать').not.toBeNull();
    expect(body![0], 'у body снова жёстко прибит тёмный фон')
      .not.toMatch(/background:\s*#0a0e1a/i);
    expect(body![0]).toContain('var(--splash-bg');
  });

  it('и хром телеграма красится до первого кадра', () => {
    expect(HTML).toContain(DESIGNS.paper.themeColor);
  });
});

/**
 * КОНТРАСТ — ЕДИНСТВЕННОЕ, ЧТО ОТЛИЧАЕТ СВЕТЛУЮ ТЕМУ ОТ НЕЧИТАЕМОЙ.
 *
 * ⚠️ И ЭТО НЕ ТЕОРИЯ: ЧИСЛА В ПЕРЕДАННОМ МАКЕТЕ НЕ СОШЛИСЬ. В его
 * комментариях стояло «--brand-muted #8C8275 — 4.6:1 на #F2EADB» и «каждый
 * тир ≥4.5:1». Пересчёт дал 3.16 для muted и 3.50 / 3.42 / 3.16 для icon,
 * legendary и common — то есть вторичный текст и три тира из пяти не
 * дотягивали до AA, а верхний стоп градиента (#FF8A3D) давал 1.96, почти
 * невидимо. Значения исправлены; эта проверка держит их на месте.
 *
 * На тёмных дизайнах те же пары считаются тем же кодом — иначе порог легко
 * подогнать под одну тему и не заметить, что он развалил другую.
 */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Значение токена как #rrggbb. Числовые токены лежат как «r g b». */
function token(selector: string, name: string): string {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(block(selector));
  expect(m, `${selector}: нет ${name}`).not.toBeNull();
  const v = m![1].trim().split('/*')[0].trim();
  if (v.startsWith('#')) return v.slice(0, 7);
  const [r, g, b] = v.split(/\s+/).map(Number);
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

describe('читаемость каждого дизайна', () => {
  const DESIGNS_CSS = {
    classic: ":root,\n  [data-design='classic']",
    master: "[data-design='master']",
    paper: "[data-design='paper']",
  } as const;

  it('основной текст — AAA на фоне и на панели', () => {
    for (const [name, sel] of Object.entries(DESIGNS_CSS)) {
      const fg = token(sel, '--brand-fg');
      expect(contrast(fg, token(sel, '--brand-bg')), `${name}: текст на фоне`)
        .toBeGreaterThanOrEqual(7);
      expect(contrast(fg, token(sel, '--brand-surface')), `${name}: текст на панели`)
        .toBeGreaterThanOrEqual(7);
    }
  });

  it('вторичный текст — AA (4.5) на фоне', () => {
    for (const [name, sel] of Object.entries(DESIGNS_CSS)) {
      expect(contrast(token(sel, '--brand-muted'), token(sel, '--brand-bg')),
             `${name}: --brand-muted`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('акцент читается ТЕКСТОМ, а не только заливкой', () => {
    // `text-brand-accent` стоит в сотне мест — это в первую очередь цвет
    // текста, и мерить его надо как текст.
    for (const [name, sel] of Object.entries(DESIGNS_CSS)) {
      expect(contrast(token(sel, '--brand-accent'), token(sel, '--brand-bg')),
             `${name}: --brand-accent как текст`).toBeGreaterThanOrEqual(4);
    }
  });

  it('счёт быстрой игры виден в каждом дизайне', () => {
    // ⚠️ ЭТИ ТРИ ЦВЕТА ЖИЛИ HEX'АМИ В TrainingScreen, И НА ТЁМНОМ ЭТО НЕ
    // МЕШАЛО: 6.45 и 6.99. На кремовом те же значения дали 2.50 и 2.30 —
    // счёт в тридцать пикселей почти пропал. Порог 3 — это AA для крупного
    // текста, а счёт крупный по определению.
    for (const [name, sel] of Object.entries(DESIGNS_CSS)) {
      const bg = token(sel, '--brand-bg');
      for (const t of ['score-left', 'score-right']) {
        expect(contrast(token(sel, `--${t}`), bg), `${name}: --${t}`)
          .toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('каждый цвет редкости виден на своём фоне', () => {
    for (const [name, sel] of Object.entries(DESIGNS_CSS)) {
      const bg = token(sel, '--brand-bg');
      for (const t of ['icon', 'legendary', 'epic', 'rare', 'common']) {
        expect(contrast(token(sel, `--tier-${t}`), bg), `${name}: --tier-${t}`)
          .toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('контроль: та же мера на заведомо плохой паре краснеет', () => {
    // ⚠️ БЕЗ ЭТОГО ВСЁ ВЫШЕ ЗЕЛЕНЕЛО БЫ И НА СЛОМАННОЙ ФОРМУЛЕ. Кремовый на
    // кремовом обязан дать единицу, чёрный на белом — двадцать один.
    expect(contrast('#F2EADB', '#F2EADB')).toBeCloseTo(1, 5);
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrast('#F4EEE6', '#F2EADB')).toBeLessThan(1.2);  // тот самый icon
  });
});
