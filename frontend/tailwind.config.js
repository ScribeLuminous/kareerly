/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        rust: "#C4531A",
        "rust-l": "#FBF0E8",
        "rust-m": "#E8813D",
        forest: "#2D4A3E",
        "forest-l": "#E8F0EC",
        "forest-m": "#4A7A65",
        brown: "#3D2314",
        tan: "#C4956A",
        "tan-l": "#F5EAD8",
        mauve: "#9B4F5C",
        "mauve-l": "#F5E8EA",
        cream: "#F5EFE0",
        "cream-d": "#E8DFC8",
        card: "#FFFFFF",
        bdr: "#EAE3D6",
        dark: "#2A1F14",
        mid: "#5C4A38",
        soft: "#9A8878",
        green: "#2D6A4F",
        "green-l": "#E8F3EE",
        red: "#C0392B",
        "red-l": "#FDECEA",
        amber: "#B7700A",
        "amber-l": "#FEF5E4",
        bg: "#FAF7F2",
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        display: ['Sora', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        tight: '-0.6px',
        tighter: '-0.3px',
        wide: '0.2px',
      },
      backgroundColor: {
        bg: '#FAF7F2',
      },
      textColor: {
        dark: '#2A1F14',
      },
    },
  },
  corePlugins: {
    preflight: true,
  },
  plugins: [],
}
