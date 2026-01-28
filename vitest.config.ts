// Vitest configuration file
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use globals for describe, it, expect without imports
    globals: true,
    // Test environment
    environment: 'node',
    // Include test files matching these patterns
    include: ['src/**/*.test.ts'],
    // Coverage configuration
    coverage: {
      // Use v8 for coverage
      provider: 'v8',
      // Report formats
      reporter: ['text', 'html'],
      // Include source files
      include: ['src/**/*.ts'],
      // Exclude test files and types from coverage
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'src/apex/types.ts'],
    },
  },
});
