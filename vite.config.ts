import { defineConfig } from 'vite';

/** ESM library entries share internal chunks; React remains a consumer peer. */
export default defineConfig({
  build: {
    target: 'es2020',
    sourcemap: false,
    lib: {
      entry: { index: 'src/index.ts', react: 'src/react/index.ts' },
      formats: ['es'],
      fileName: (_format, entry) => `${entry}.js`,
    },
    rolldownOptions: { external: ['react', 'react-dom'] },
  },
});
