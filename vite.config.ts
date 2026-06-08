import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { llmProxy } from './server/llmProxy';

// Relative base so the build works under GitHub Pages project subpaths.
export default defineConfig({
  base: './',
  plugins: [react(), llmProxy()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
