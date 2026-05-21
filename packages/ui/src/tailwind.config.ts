import type { Config } from 'tailwindcss';

declare const require: any;

/**
 * Preset Tailwind compartilhado.
 * Cada app (web, admin, landing) importa via `presets: [require('@prospix/ui/tailwind.config')]`
 * e estende com seus próprios `content` paths.
 */
export const prospixPreset: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: 'var(--primary)',
          hover: 'var(--primary-hover)',
          soft: 'var(--primary-soft)',
          softer: 'var(--primary-softer)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          soft: 'var(--secondary-soft)',
          softer: 'var(--secondary-softer)',
          text: 'var(--secondary-text)',
        },
        bg: {
          DEFAULT: 'var(--bg)',
          sunken: 'var(--surface-sunken)',
        },
        text: {
          DEFAULT: 'var(--text)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        surface: {
          DEFAULT: 'var(--surface)',
          sunken: 'var(--surface-sunken)',
        },
        border: {
          DEFAULT: 'var(--border)',
          subtle: 'var(--border-subtle)',
          strong: 'var(--border-strong)',
        },
        muted: 'var(--text-muted)',
        success: {
          DEFAULT: 'var(--success)',
          soft: 'var(--success-soft)',
          text: 'var(--success-text)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          soft: 'var(--warning-soft)',
          text: 'var(--warning-text)',
        },
        error: {
          DEFAULT: 'var(--error)',
          soft: 'var(--error-soft)',
          text: 'var(--error-text)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
        heading: ['Inter', 'sans-serif'],
      },
      fontSize: {
        '2xs': '0.625rem',
        'md': '1rem',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        lg: 'var(--radius-lg)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

const config: Config = {
  content: [], // cada app preenche os próprios paths
  presets: [],
  ...prospixPreset,
} as Config;

export default config;
