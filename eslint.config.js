import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.astro/**',
      '**/.wrangler/**',
      '**/worker-configuration.d.ts',
      'docs/**',
      '.bmad-core/**',
      '.claude/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    // Coding standards: never call console.log directly. Use the structured logger.
    rules: {
      'no-console': 'error',
    },
  },
  {
    // The single place per app or script folder that hands the console to the logger.
    files: ['apps/web/src/lib/log.ts', 'apps/pipeline/src/log.ts', 'scripts/ops/src/log.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];
