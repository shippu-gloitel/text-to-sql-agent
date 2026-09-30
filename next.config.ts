import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactCompiler: true,
  typedRoutes: true,
  devIndicators: {
    position: 'bottom-right',
  },
  logging: {
    browserToTerminal: process.env.NODE_ENV === 'development',
  },
  experimental: {
    typedEnv: true,
    globalNotFound: true,
  },
};

export default nextConfig;
