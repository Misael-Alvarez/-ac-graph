import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // One-off Node scripts that regenerate the icon sprite; not app code.
    'coverage/**',
    // One-off generators run by hand, not part of the app bundle.
    'scripts/**',
    'generate-icons.js',
    '*.py',
  ]),
]);

export default eslintConfig;
