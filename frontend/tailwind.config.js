/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'ide-bg': '#1e1e1e',
        'ide-sidebar': '#252526',
        'ide-panel': '#1e1e1e',
        'ide-border': '#3c3c3c',
        'ide-active': '#094771',
        'ide-hover': '#2a2d2e',
        'ide-text': '#cccccc',
        'ide-text-muted': '#858585',
      },
    },
  },
  plugins: [],
};
