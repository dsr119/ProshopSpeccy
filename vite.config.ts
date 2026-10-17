import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves the app from /<repo>/; the deploy workflow sets VITE_BASE.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173 },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
