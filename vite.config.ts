import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const serverTarget = `http://127.0.0.1:${process.env.PORT ?? '3000'}`;

// Frontend ada di web/. Hasil build ke dist/ (disajikan oleh server).
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    // folder shared/ ada di luar root Vite
    fs: { allow: [repoRoot] },
    proxy: {
      '/api': serverTarget,
      '/files': serverTarget,
      '/frames': serverTarget,
      '/ws': { target: serverTarget, ws: true },
    },
  },
});
