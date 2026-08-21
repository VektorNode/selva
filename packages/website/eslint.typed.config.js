import { createConfig } from '@selvajs/config/eslint';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The type-aware pass — `pnpm lint:types`. Separate from eslint.config.js because
// `projectService` builds a full TypeScript program per file and dominates lint
// wall-clock; day-to-day `pnpm lint` stays untyped.
export default createConfig(__dirname, { typed: true });
