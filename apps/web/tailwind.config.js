/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#080808',
        sidebar: '#0A0A0A',
        secondary: '#0D0D0D',
        card: '#111111',
        elevated: '#171717',
        input: '#101010',
        border: '#262626',
        'secondary-border': '#333333',
        primaryText: '#F5F5F5',
        secondaryText: '#A1A1AA',
        mutedText: '#71717A',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '8px',
        md: '10px',
        lg: '12px',
      },
    },
  },
  plugins: [],
};
