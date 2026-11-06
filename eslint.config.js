import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The engine must stay pure and deterministic: all randomness comes from
    // the seeded generator in state, and nothing depends on the presentation.
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', 'Date', 'window', 'document', 'performance'],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random' }],
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/render/**', '**/ui/**', '**/app/**', '**/content/**', 'pixi.js', 'preact', 'preact/*'],
          message: 'The engine must not depend on other layers.',
        }],
      }],
    },
  },
);
