import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV === 'development';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactCompiler: true,
  typedRoutes: true,
  devIndicators: {
    position: 'bottom-right',
  },
  logging: {
    browserToTerminal: isDev,
  },
  experimental: {
    typedEnv: true,
    globalNotFound: true,
  },
};

export default nextConfig;
