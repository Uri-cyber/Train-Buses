import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`          -> chunked build in dist/ (GitHub Pages)
// `SINGLE=1 npm run build` -> one self-contained dist-single/index.html
const single = process.env.SINGLE === '1';

export default defineConfig({
  base: process.env.BASE ?? './',
  plugins: single ? [viteSingleFile()] : [],
  json: { stringify: true },          // big data files parse faster as strings
  build: {
    outDir: single ? 'dist-single' : 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 2500,
    assetsInlineLimit: single ? 100000000 : 4096,
    // the accessibility statement is a second page, so it has to be named as an input;
    // the single-file build stays one page, as its whole point is one file
    ...(single ? {} : { rollupOptions: { input: {
      index: resolve(__dirname, 'index.html'),
      accessibility: resolve(__dirname, 'accessibility.html'),
    } } }),
  },
});
