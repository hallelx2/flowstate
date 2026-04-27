import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

// @flowstate/core is a workspace package that ships its TS source directly
// (package.json main → ./src/index.ts) for fast HMR in the renderer. The main
// + preload bundles must NOT externalize it — Node ESM can't load .ts at
// runtime, so we let electron-vite bundle + transform it into the output.
const WORKSPACE_INTERNALS = ['@flowstate/core'];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_INTERNALS })],
    build: {
      outDir: 'out/main',
      lib: { entry: 'electron/main/index.ts' },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_INTERNALS })],
    build: {
      outDir: 'out/preload',
      lib: { entry: 'electron/preload/index.ts' },
    },
  },
  renderer: {
    root: '.',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@flowstate/core': resolve(__dirname, '../../packages/core/src'),
      },
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: resolve(__dirname, 'index.html'),
      },
    },
    server: {
      port: 5180,
    },
  },
});
