import type { Config } from 'tailwindcss';
import {
  ACCENT, BG, BORDER, DANGER, INFO, MUTED, PRO, SLATE, SUCCESS, SURFACE, WARNING,
} from './src/shared/ui/palette';

// Colours come from src/shared/ui/palette.ts, so the utility classes and the
// inline styles components need for SVG strokes and per-card accents are
// generated from the same numbers — see the note at the top of that file.
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          accent:  ACCENT,
          bg:      BG,
          surface: SURFACE,
          border:  BORDER,
          muted:   MUTED,
          slate:   SLATE,
          // Semantic roles — ask for the meaning, not the hue.
          success: SUCCESS,
          warning: WARNING,
          danger:  DANGER,
          info:    INFO,
          pro:     PRO,
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
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
