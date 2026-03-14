import type { NextConfig } from 'next';

const basePath = '/windotwatchr/nextjs';

const config: NextConfig = {
  output: 'export',
  basePath,
  trailingSlash: true,
  transpilePackages: ['windotwatchr'],
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default config;
