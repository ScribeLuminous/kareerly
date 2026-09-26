import plugin from 'tailwindcss/plugin';

/**
 * Kareerly palette. This is the single source of the brand colours: Tailwind
 * classes use it directly and the plugin below exposes each value as a CSS
 * variable (`--rust`, `--soft-text`, …) for the page stylesheets.
 */
const palette = {
  rust: '#C4531A',
  'rust-l': '#FBF0E8',
  'rust-m': '#E8813D',
  forest: '#2D4A3E',
  'forest-l': '#E8F0EC',
  'forest-m': '#4A7A65',
  brown: '#3D2314',
  tan: '#C4956A',
  'tan-l': '#F5EAD8',
  mauve: '#9B4F5C',
  'mauve-l': '#F5E8EA',
  cream: '#F5EFE0',
  'cream-d': '#E8DFC8',
  card: '#FFFFFF',
  bdr: '#EAE3D6',
  dark: '#2A1F14',
  mid: '#5C4A38',
  // Decorative only (icons, placeholders, disabled). Text uses soft-text, which
  // keeps the same hue but meets WCAG AA on white and on bg.
  soft: '#9A8878',
  'soft-text': '#7A6858',
  green: '#2D6A4F',
  'green-l': '#E8F3EE',
  red: '#C0392B',
  'red-l': '#FDECEA',
  amber: '#B7700A',
  'amber-l': '#FEF5E4',
  bg: '#FAF7F2',
};

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: palette,
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        display: ['Sora', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        tight: '-0.6px',
        tighter: '-0.3px',
        wide: '0.2px',
      },
      boxShadow: {
        overlay: '0 12px 32px rgba(42, 31, 20, 0.14)',
        modal: '0 16px 48px rgba(42, 31, 20, 0.18)',
      },
    },
  },
  corePlugins: {
    preflight: true,
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({ ':root': Object.fromEntries(Object.entries(palette).map(([name, value]) => [`--${name}`, value])) });
    }),
  ],
}
