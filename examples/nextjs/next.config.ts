import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const basePath = '/windotwatchr/nextjs';

const config: NextConfig = {
  output: 'export',
  basePath,
  trailingSlash: true,
  transpilePackages: ['windotwatchr'],
  turbopack: {
    root: fileURLToPath(new URL('../../', import.meta.url)),
    resolveAlias: {
      windotwatchr: '../../dist/index.js',
      'windotwatchr/react': '../../dist/react.js',
    },
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default config;
