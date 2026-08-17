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
        // Brand navy — from the Alken Decor logo. Structural: nav, links, focus,
        // primary buttons. Full ramp so shades stay harmonious.
        brand: {
          50: '#eef3f9',
          100: '#d6e0ee',
          200: '#b0c4dd',
          300: '#7f9ec5',
          400: '#4d72a3',
          500: '#2d5183',
          600: '#1e3c66',
          700: '#182f50',
          800: '#14284a',
          900: '#101f3a',
          950: '#0a1526',
        },
        // Brand orange — the logo's accent. Used deliberately for emphasis and
        // identity (mark, wordmark, highlights), not as a general fill.
        accent: {
          50: '#fff5ec',
          100: '#ffe6d0',
          200: '#ffc9a1',
          300: '#ffa568',
          400: '#fb8536',
          500: '#f47a21',
          600: '#e0620f',
          700: '#ba4a10',
          800: '#943c15',
          900: '#783414',
          950: '#411806',
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
        // The wash behind a modal. One token so the dialog backdrop and the
        // mobile drawer overlay cannot drift apart.
        scrim: 'rgb(var(--scrim) / <alpha-value>)',
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
