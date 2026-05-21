import type { Config } from 'tailwindcss';
import prospixPreset from '@prospix/ui/tailwind.config';

const config: Config = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  presets: [prospixPreset],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
