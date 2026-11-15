import type { Config } from 'tailwindcss';

const v = (name: string) => `rgb(var(--ml-${name}) / <alpha-value>)`;

export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        elevated: v('elevated'),
        border: v('border'),
        text: v('text'),
        muted: v('muted'),
        subtle: v('subtle'),
        accent: v('accent'),
        'accent-fg': v('accent-fg'),
        ok: v('ok'),
        warn: v('warn'),
        danger: v('danger'),
      },
      fontFamily: {
        ui: ['var(--ml-font)'],
      },
      boxShadow: {
        pop: '0 12px 32px -8px rgb(0 0 0 / 0.45), 0 2px 6px rgb(0 0 0 / 0.25)',
      },
      keyframes: {
        'ml-in': {
          '0%': { opacity: '0', transform: 'translateY(6px) scale(0.94)' },
          '60%': { opacity: '1', transform: 'translateY(-1px) scale(1.006)' },
          '100%': { opacity: '1', transform: 'none' },
        },
        'ml-spin': { to: { transform: 'rotate(360deg)' } },
      },
      animation: {
        'ml-in': 'ml-in var(--ml-anim, 320ms) cubic-bezier(.2,.8,.2,1)',
        'ml-spin': 'ml-spin 0.8s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
