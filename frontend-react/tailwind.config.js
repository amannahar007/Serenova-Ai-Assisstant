/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        void: '#eeebe2',
        obsidian: '#ffffff',
        slate: '#f3efe6',
        'glass-border': '#ded7c8',
        neu: {
          base: '#eeebe2',
          light: '#f7f4ec',
          dark: '#e3dfd3',
          shadow: '#d0c9bc',
          highlight: '#ffffff',
          teal: '#244d50',
          'teal-light': '#2f6064',
          'teal-dark': '#1b3b3d',
          gold: '#b2873c',
          rose: '#8a5649',
          sage: '#5f8050',
        },
        neon: {
          cyan: '#244d50',
          purple: '#8a5649',
          pink: '#a6776c',
          amber: '#b2873c',
          green: '#5f8050',
        },
        text: {
          primary: '#1a1f1e',
          dim: '#48504e',
          muted: '#767c78',
        }
      },
      boxShadow: {
        'neu-raised-sm': '3px 3px 7px rgba(185, 177, 163, 0.45), -3px -3px 7px rgba(255, 255, 255, 0.95)',
        'neu-raised': '6px 6px 14px rgba(185, 177, 163, 0.45), -6px -6px 14px rgba(255, 255, 255, 0.95)',
        'neu-raised-lg': '10px 10px 22px rgba(180, 172, 158, 0.5), -10px -10px 22px rgba(255, 255, 255, 1.0)',
        'neu-inset': 'inset 3px 3px 6px rgba(185, 177, 163, 0.45), inset -3px -3px 6px rgba(255, 255, 255, 0.95)',
        'neu-inset-deep': 'inset 5px 5px 10px rgba(180, 172, 158, 0.5), inset -5px -5px 10px rgba(255, 255, 255, 0.95)',
        'neu-pressed': 'inset 2px 2px 5px rgba(185, 177, 163, 0.5), inset -2px -2px 5px rgba(255, 255, 255, 0.9)',
      },
      borderRadius: {
        'neu-sm': '12px',
        'neu-md': '18px',
        'neu-lg': '24px',
        'neu-xl': '32px',
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
