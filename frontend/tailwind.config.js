/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        slate: {
          850: '#0f172a',
          925: '#090d16',
          950: '#04070d',
        },
        brand: {
          50: '#f0fdf4',
          100: '#dcfce7',
          400: '#34d399',
          500: '#10b981', // Electric Emerald
          600: '#059669',
          700: '#047857',
        },
        accent: {
          cyan: '#06b6d4',
          indigo: '#6366f1',
          violet: '#8b5cf6',
          amber: '#f59e0b',
        }
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-glow': 'pulseGlow 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'scan-radar': 'scanRadar 2.2s cubic-bezier(0.4, 0, 0.2, 1) infinite',
        'float-slow': 'floatSlow 5s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'fade-in-up': 'fadeInUp 0.4s ease-out forwards',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { opacity: 1, boxShadow: '0 0 25px rgba(16, 185, 129, 0.4)' },
          '50%': { opacity: 0.6, boxShadow: '0 0 10px rgba(16, 185, 129, 0.15)' },
        },
        scanRadar: {
          '0%': { top: '0%', opacity: 0.8 },
          '50%': { top: '95%', opacity: 1 },
          '100%': { top: '0%', opacity: 0.8 },
        },
        floatSlow: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        fadeInUp: {
          '0%': { opacity: 0, transform: 'translateY(12px)' },
          '100%': { opacity: 1, transform: 'translateY(0px)' },
        }
      }
    },
  },
  plugins: [],
}
