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
