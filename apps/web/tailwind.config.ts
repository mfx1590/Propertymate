import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7f2',
          500: '#0f766e',
          600: '#0d5f58',
          900: '#083f3a',
        },
      },
    },
  },
  plugins: [],
};

export default config;
