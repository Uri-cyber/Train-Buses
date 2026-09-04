import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`        -> normal chunked build in dist/ (used by GitHub Pages)
// `SINGLE=1 npm run build` -> one self-contained dist/index.html, as before
const single = process.env.SINGLE === '1';

export default defineConfig({
  base: process.env.BASE ?? './',
  plugins: single ? [viteSingleFile()] : [],
  build: {
    outDir: single ? 'dist-single' : 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    assetsInlineLimit: single ? 100000000 : 4096,
  },
});
