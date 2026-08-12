import { config } from '../config/eslint.config.js';

/**
 * Mirrors `packages/compute/eslint.config.mjs`: the shared flat config, WITHOUT the type-aware
 * `createConfig(__dirname)` wrapper.
 *
 * `createConfig` enables `parserOptions.projectService`, which then requires every linted file to
 * belong to a tsconfig project. Root config files (`tsup.config.ts`, `vitest.config.ts`) sit outside
 * this package's `include` (`src/**`, `tests/**`) on purpose, so type-aware linting fails on them
 * with "was not found by the project service". The root ESLint run never surfaced that — it ignores
 * those filenames — but lint-staged passes explicit paths and bypasses the ignore.
 */
export default config;
