import { defineConfig } from 'vite';

export default defineConfig({
  base: '/Cognitive_Siege/',
  server: {
    port: 5180,
    open: true,
  },
  build: {
    target: 'es2020',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
});
