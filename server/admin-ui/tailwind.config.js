/** @type {import('tailwindcss').Config} */
const ch = (name) => `rgb(var(--gd-${name}-rgb) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Manrope', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      // Токены темы (src/index.css). Цвета статусов и акцент поддерживают /прозрачность: bg-gd-ok/15.
      colors: {
        gd: {
          ink: 'var(--gd-ink)',
          muted: 'var(--gd-muted)',
          line: 'var(--gd-line)',
          inner: 'var(--gd-inner)',
          raised: 'var(--gd-raised)',
          surface: 'var(--gd-surface)',
          track: 'var(--gd-track)',
          accent: ch('accent'),
          'on-accent': 'var(--gd-on-accent)',
          ok: ch('ok'),
          warn: ch('warn'),
          danger: ch('danger'),
          'on-danger': 'var(--gd-on-danger)',
        },
      },
    },
  },
  plugins: [],
};
