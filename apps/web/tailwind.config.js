/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f6fe',
          100: '#dceafc',
          500: '#2a78d6',
          600: '#1f63b8',
          700: '#1a5199',
          900: '#12335e',
        },
      },
    },
  },
  plugins: [],
};
