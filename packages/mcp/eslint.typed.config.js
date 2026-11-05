import { createConfig } from '@selvajs/config/eslint';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The type-aware pass — see the note in `@selvajs/platform`'s copy. Library
// package, no routes, so src/ is the whole surface worth typing.
export default createConfig(__dirname, { typed: true, typedFiles: ['src/**/*.ts'] });
