/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Semantic colour tokens → CSS variables in index.css that flip under `.dark`.
      // A component using these needs NO `dark:` variant; the token carries the theme.
      // e.g. `bg-surface text-content border-line`, `text-accent-text`, `bg-accent`.
      colors: {
        // NOTE: named `canvas`, NOT `base` — a `base` color makes Tailwind emit a
        // `text-base` COLOR utility that collides with the built-in `text-base`
        // font-size, silently painting text the surface colour (invisible). See §24.
        canvas: 'rgb(var(--surface-base) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        raised: 'rgb(var(--surface-raised) / <alpha-value>)',
        sunken: 'rgb(var(--surface-sunken) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        'line-strong': 'rgb(var(--line-strong) / <alpha-value>)',
        content: 'rgb(var(--content) / <alpha-value>)',
        muted: 'rgb(var(--content-muted) / <alpha-value>)',
        subtle: 'rgb(var(--content-subtle) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          text: 'rgb(var(--accent-text) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover) / <alpha-value>)',
          contrast: 'rgb(var(--accent-contrast) / <alpha-value>)',
          soft: 'rgb(var(--accent-soft) / <alpha-value>)',
        },
        danger: 'rgb(var(--danger) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        raised: 'var(--shadow-raised)',
      },
      keyframes: {
        'fade-scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.97)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-up-fade': {
          '0%': { opacity: '0', transform: 'translateY(15px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        }
      },
      animation: {
        'fade-scale-in': 'fade-scale-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'slide-up-fade': 'slide-up-fade 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      }
    },
  },
  plugins: [],
}