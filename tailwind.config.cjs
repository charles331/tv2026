/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Dark-first palette for the IPTV catalogue UI.
        surface: {
          DEFAULT: '#0f1115',
          raised: '#171a21',
          overlay: '#1f232c',
          sunken: '#0b0d12'
        },
        accent: {
          DEFAULT: '#6366f1',
          hover: '#818cf8',
          soft: 'rgba(99,102,241,0.16)'
        }
      },
      boxShadow: {
        poster: '0 8px 24px -8px rgba(0,0,0,0.6)',
        'poster-hover': '0 16px 40px -12px rgba(0,0,0,0.7)'
      }
    }
  },
  plugins: []
}
