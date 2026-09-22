// Rarity-tier visuals — subtle coloured frame/glow, shared by the in-game card
// and the history avatars. 'common' (and unknown) get NO treatment, so the deck
// doesn't look noisy; rarer tiers glow a touch more.
//
// ⚠️ ЦВЕТ РЕДКОСТИ БОЛЬШЕ НЕ КОНСТАНТА, И ЭТО НЕ ЧИСТОПЛЮЙСТВО. `TIER_COLOR`
// подобран под почти чёрный фон: `icon` там — #F4EEE6, то есть на кремовой
// бумаге он исчезает целиком, а золото и синий падают ниже AA как текст.
// Этот файл читал константу напрямую, поэтому никакой токен до него не
// доставал — и светлый дизайн был бы светлым везде, кроме карточек.
//
// Теперь цвет берётся из `var(--tier-…)` с `TIER_COLOR` в запасе. Запас —
// не формальность: вне браузера (тесты, серверный рендер) переменных нет
// вовсе, и без него строка стиля осталась бы без цвета.
//
// Вес обработки по-прежнему решает дизайн: master рамит жёстче и светит шире,
// чем classic. Вызывающие, которым нужна мгновенная перекраска при смене
// дизайна, передают значение из useDesign(); без него читается текущая
// настройка один раз, в момент вызова.

import type { CSSProperties } from 'react';
import { TIER_COLOR, TIERS, type Tier } from '@/shared/types/database';
import { getDesign } from '@/shared/design/useDesign';
import type { DesignId } from '@/shared/design/designs';

function asTier(t?: string | null): Tier | null {
  return t && (TIERS as string[]).includes(t) ? (t as Tier) : null;
}

/** Цвет редкости ДЛЯ АКТИВНОГО ДИЗАЙНА. Возвращается именно `var()`, чтобы
 *  смена дизайна перекрасила уже нарисованную карточку без перерисовки. */
function tierColor(t: Tier): string {
  return `var(--tier-${t}, ${TIER_COLOR[t]})`;
}

/** Тот же цвет с прозрачностью.
 *
 *  ⚠️ СКЛЕЙКА HEX'А С АЛЬФОЙ (`${c}80`) ПЕРЕСТАЁТ РАБОТАТЬ В ТУ ЖЕ СЕКУНДУ,
 *  КАК `c` СТАНОВИТСЯ `var()`: получается `var(--tier-epic, #B47AFF)80` —
 *  мусор, который браузер молча выбрасывает вместе со всей тенью. Поэтому
 *  проценты, а не хвост из двух шестнадцатеричных цифр. */
const fade = (c: string, percent: number) =>
  `color-mix(in srgb, ${c} ${percent}%, transparent)`;

/** Border + soft outward glow for a big card (in-game). Common/unknown → none. */
export function tierCardStyle(tier?: string | null, design: DesignId = getDesign()): CSSProperties | undefined {
  const t = asTier(tier);
  if (!t || t === 'common') return undefined;
  const c = tierColor(t);
  const master = design === 'master';
  // 'icon' is the top tier: the thickest frame and the widest, whitest glow.
  const ring = t === 'icon' ? '2px' : master ? '1.5px' : '1px';
  // px radius, then opacity — master roughly doubles the spread and lifts the
  // opacity so a legendary reads as lit rather than outlined. Проценты — это
  // прежние hex-альфы один в один: 59→35, 80→50, 70→44, 66→40, 55→33, 40→25.
  const [blur, alpha] =
    t === 'icon'      ? (master ? [40, 35] : [24, 35])
    : t === 'legendary' ? (master ? [34, 50] : [18, 40])
    : t === 'epic'    ? (master ? [26, 44] : [14, 33])
    :                   (master ? [22, 33] : [10, 25]);
  return {
    borderColor: c,
    boxShadow: `inset 0 0 0 ${ring} ${c}, 0 0 ${blur}px ${fade(c, alpha)}`,
  };
}

/** Gradient rarity frame for the master design: a thin padded wrapper whose
 * background is the gradient, with the card drawn inside it. Classic keeps the
 * inset ring from tierCardStyle instead, so this returns undefined there —
 * callers render the plain card when it does. */
export function tierFrameStyle(tier?: string | null, design: DesignId = getDesign()): CSSProperties | undefined {
  if (design !== 'master') return undefined;
  const t = asTier(tier);
  if (!t || t === 'common') return undefined;
  const c = tierColor(t);
  const pad = t === 'icon' ? '2px' : '1.5px';
  const blur = t === 'icon' ? 40 : t === 'legendary' ? 34 : t === 'epic' ? 26 : 22;
  return {
    padding: pad,
    // bf→75, 1f→12, 8c→55, 47→28.
    background: `linear-gradient(155deg, ${fade(c, 75)}, ${fade(c, 12)} 45%, ${fade(c, 55)})`,
    boxShadow: `0 0 ${blur}px ${fade(c, 28)}`,
  };
}

/** Subtle ring around a small history avatar. Common/unknown → none. */
export function tierRingStyle(tier?: string | null, design: DesignId = getDesign()): CSSProperties | undefined {
  const t = asTier(tier);
  if (!t || t === 'common') return undefined;
  const c = tierColor(t);
  // 99→60, 88→53, 66→40.
  if (t === 'icon') {
    return { boxShadow: `0 0 0 2px ${c}, 0 0 ${design === 'master' ? 16 : 10}px ${fade(c, 60)}` };
  }
  return design === 'master'
    ? { boxShadow: `0 0 0 2px ${c}, 0 0 12px ${fade(c, 53)}` }
    : { boxShadow: `0 0 0 2px ${c}, 0 0 6px ${fade(c, 40)}` };
}
