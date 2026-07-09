import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      './test/plugin-entry.test.js'
    ],
    testTimeout: 10000
  }
});