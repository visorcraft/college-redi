import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        sky: { soft: '#EAF3FB' },
        navy: { DEFAULT: '#1F2D50', light: '#2E416E' },
        accent: '#FFC24B',
      },
      borderRadius: { xl: '12px', '2xl': '16px' },
    },
  },
  plugins: [],
} satisfies Config;
