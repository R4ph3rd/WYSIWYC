import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Config séparée de vite.config.ts : on ne charge pas llmProxy en test.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'node', // l'IR est pure logique, pas besoin de DOM
    include: ['src/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['src/ir/**'] },
  },
});
