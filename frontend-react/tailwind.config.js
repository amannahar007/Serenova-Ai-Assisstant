/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        void: '#fdfcf8',
        obsidian: '#ffffff',
        slate: '#f5f3eb',
        'glass-border': '#e6e2d6',
        neon: {
          cyan: '#3b5b59',
          purple: '#8c5a4d',
          pink: '#a87b70',
          amber: '#b58c42',
          green: '#688a58',
        },
        text: {
          primary: '#2b2927',
          dim: '#5c5954',
          muted: '#858076',
        }
      },
      fontFamily: {
        main: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
        serif: ['Georgia', 'serif'],
      }
    },
  },
  plugins: [],
}
