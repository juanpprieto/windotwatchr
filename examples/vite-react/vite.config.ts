import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: '/windotwatchr/vite-react/',
  plugins: [react()],
  resolve: {
    alias: [
      { find: 'windotwatchr/react', replacement: fileURLToPath(new URL('../../dist/react.js', import.meta.url)) },
      { find: 'windotwatchr', replacement: fileURLToPath(new URL('../../dist/index.js', import.meta.url)) },
    ],
  },
});
