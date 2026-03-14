import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'export',
  basePath: '/windotwatchr/nextjs',
  trailingSlash: true,
  transpilePackages: ['windotwatchr'],
};

export default config;
