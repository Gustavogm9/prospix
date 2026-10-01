import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Prevent a stray user-level package-lock.json from becoming the tracing root.
  outputFileTracingRoot: path.resolve(appDir, '../..'),
  // Transpile workspace packages
  transpilePackages: ['@prospix/ui', '@prospix/shared-types'],
  // Only lint the app directory (skip legacy src/pages/ during migration)
  eslint: {
    ignoreDuringBuilds: true,
    dirs: ['src/app', 'src/components', 'src/hooks', 'src/layout', 'src/lib', 'src/store'],
  },
  webpack: (config) => {
    // @prospix/ui uses .js extensions in imports (e.g. './lib/cn.js')
    // but actual files are .ts/.tsx. This tells webpack to try .ts/.tsx
    // when a .js import can't be found.
    config.resolve.extensionAlias = {
      '.js': ['.js', '.ts', '.tsx'],
      '.jsx': ['.jsx', '.tsx'],
    };
    return config;
  },
};

export default nextConfig;
