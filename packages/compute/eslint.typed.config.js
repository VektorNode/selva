import { createConfig } from '@selvajs/config/eslint';

// The type-aware pass, `pnpm lint:types`. Scoped to the transport and the scheduler: a dropped
// promise there loses a settle, and the rest of the package is synchronous parsing.
export default [
	...createConfig(import.meta.dirname, {
		typed: true,
		typedFiles: ['src/core/compute-fetch/*.ts', 'src/grasshopper/scheduler/*.ts']
	}),
	{ ignores: ['docs/api/'] }
];
