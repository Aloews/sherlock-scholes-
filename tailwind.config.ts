import type { Config } from 'tailwindcss';

// Brand colours resolve through CSS variables so the whole palette can be
// swapped at runtime by the design switcher (see src/index.css and
// shared/design/designs.ts). The `<alpha-value>` placeholder is what keeps
// opacity modifiers — bg-brand-surface/50, text-brand-muted/70 — working.
const brand = (name: string) => `rgb(var(--brand-${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // ⚠️ TAILWIND'ОВСКИЙ `white` ПЕРЕВЕШЕН НА ТОКЕН, И ЭТО НЕ ХИТРОСТЬ, А
        // ЕДИНСТВЕННЫЙ СПОСОБ СДЕЛАТЬ СВЕТЛЫЙ ДИЗАЙН. В `src/` около 340 мест
        // пишут `text-white`, `bg-white/5`, `border-white/10` — на тёмных
        // дизайнах это незаметно, на кремовой бумаге нечитаемо. Править их по
        // одному значило бы переписать треть кодовой базы и столкнуться с
        // каждой открытой веткой.
        //
        // В classic и master `--brand-fg` равен `255 255 255`, поэтому для
        // них собранный CSS даёт тот же самый цвет, что и до правки, — это
        // проверяется сравнением сборок.
        //
        // ⚠️ `black` НЕ ПЕРЕВЕШИВАЕТСЯ НАМЕРЕННО: `bg-black/45–55` — это
        // затемнение ПОВЕРХ фотографии, и оно обязано остаться тёмным в любом
        // дизайне. Белый текст внутри такого затемнения тоже остаётся белым —
        // для него есть `.ds-on-media`.
        white: 'rgb(var(--brand-fg) / <alpha-value>)',

        brand: {
          accent:     brand('accent'),
          accentSoft: brand('accent-soft'),
          accentDeep: brand('accent-deep'),
          highlight:  brand('highlight'),
          bg:         brand('bg'),
          surface:    brand('surface'),
          border:     brand('border'),
          muted:      brand('muted'),
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        // Design-dependent: Playfair Display in master, Inter in classic.
        display: ['var(--font-display)'],
      },
      animation: {
        'pulse-fast': 'pulse 0.8s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-up':   'slideUp 0.3s ease-out',
        'fade-in':    'fadeIn 0.2s ease-out',
      },
      keyframes: {
        slideUp: {
          '0%':   { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)',    opacity: '1' },
        },
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
