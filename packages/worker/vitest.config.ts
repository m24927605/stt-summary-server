import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    mockReset: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      exclude: ['src/index.ts', 'src/__tests__/**', 'vitest.config.ts'],
    },
  },
  resolve: {
    alias: { shared: path.resolve(__dirname, '../../shared') },
  },
});
