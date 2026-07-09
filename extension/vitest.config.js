import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/figma-plugin.test.js'],
    testTimeout: 10000,
  },
});