import { defineConfig } from 'vite';
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
  },
});
