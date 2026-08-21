import { createConfig } from '@selvajs/config/eslint';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The type-aware pass — `pnpm lint:types`. Separate from eslint.config.js because
// `projectService` builds a full TypeScript program per file and dominates lint
// wall-clock; day-to-day `pnpm lint` stays untyped.
//
// This is a library package with no routes, so the app-shaped default globs match
// nothing — the whole of src/ is the async surface worth typing.
export default createConfig(__dirname, { typed: true, typedFiles: ['src/**/*.ts'] });
