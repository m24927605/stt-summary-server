import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/server/vitest.config.ts',
  'packages/worker/vitest.config.ts',
  'packages/frontend/vite.config.ts',
]);
