import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { queryLibrary } from './vite-plugin-library';

const API = process.env.API_ORIGIN ?? 'http://localhost:8787';

export default defineConfig({
  root: 'web',
  plugins: [react(), queryLibrary()],
  resolve: { alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) } },
  build: { outDir: '../dist/web', emptyOutDir: true, sourcemap: true },
  server: {
    port: 5173,
    proxy: { '/api': API, '/auth': API },
  },
});
