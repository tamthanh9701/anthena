import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    exclude: ['node_modules', 'storage', 'data'],
    testTimeout: 10000,
    hookTimeout: 10000,
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.js'],
      exclude: [
        'src/index.js',
        'src/db/migrate.js',
        'node_modules',
      ],
    },
    // For CommonJS modules
    server: {
      deps: {
        inline: ['better-sqlite3'],
      },
    },
  },
});