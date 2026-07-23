/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter Variable',
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      colors: {
        // Refined, trustworthy brand blue — full ramp so shades stay harmonious.
        brand: {
          50: '#eff6fe',
          100: '#dceafc',
          200: '#c0dbfa',
          300: '#93c3f6',
          400: '#5fa2ef',
          500: '#3a81e4',
          600: '#2565cc',
          700: '#1e51a6',
          800: '#1e4585',
          900: '#1d3c6e',
          950: '#142547',
        },
        // Semantic tokens (defined in index.css). Drive theming from one place.
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          muted: 'rgb(var(--surface-muted) / <alpha-value>)',
          sunken: 'rgb(var(--surface-sunken) / <alpha-value>)',
        },
        hairline: {
          DEFAULT: 'rgb(var(--border) / <alpha-value>)',
          strong: 'rgb(var(--border-strong) / <alpha-value>)',
        },
        fg: {
          DEFAULT: 'rgb(var(--fg) / <alpha-value>)',
          muted: 'rgb(var(--fg-muted) / <alpha-value>)',
          subtle: 'rgb(var(--fg-subtle) / <alpha-value>)',
        },
      },
      borderRadius: {
        lg: '0.625rem', // 10px — unified control radius
        xl: '0.875rem', // 14px — cards
        '2xl': '1.125rem', // 18px — sheets, large tiles
      },
      boxShadow: {
        // Two-tier elevation: resting surfaces vs. raised/floating.
        xs: '0 1px 2px 0 rgb(15 23 42 / 0.04)',
        sm: '0 1px 3px 0 rgb(15 23 42 / 0.06), 0 1px 2px -1px rgb(15 23 42 / 0.05)',
        md: '0 4px 12px -2px rgb(15 23 42 / 0.08), 0 2px 6px -2px rgb(15 23 42 / 0.05)',
        lg: '0 12px 28px -6px rgb(15 23 42 / 0.14), 0 6px 12px -8px rgb(15 23 42 / 0.08)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.16s ease-out',
      },
    },
  },
  plugins: [],
};
