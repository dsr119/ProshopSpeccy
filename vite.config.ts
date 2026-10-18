import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves the app from /<repo>/; the deploy workflow sets VITE_BASE.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  // Two pages: the app itself, and the separate paper sheet intake page at /intake/.
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        intake: fileURLToPath(new URL('./intake/index.html', import.meta.url)),
      },
    },
  },
  server: { host: '127.0.0.1', port: 5173 },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
