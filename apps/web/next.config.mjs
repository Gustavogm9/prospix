/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile workspace packages
  transpilePackages: ['@prospix/ui', '@prospix/shared-types'],
  // Only lint the app directory (skip legacy src/pages/ during migration)
  eslint: {
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
