/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '/tmp/**'],
    setupFiles: ['./tests/vitest-setup.ts'],
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/workers/**',
        'src/locales/**',
        'src/styles/**',
      ],
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
    },
    // Inline dependencies that don't ship ESM
    deps: {
      inline: [/i18next/],
    },
  },
});
