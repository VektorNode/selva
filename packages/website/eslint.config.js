import { createConfig } from '@selvajs/config/eslint';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default [
	...createConfig(__dirname),
	{
		// No unknown classes left here, so a new one fails the lint.
		files: ['**/*.svelte', '**/*.ts'],
		rules: { 'shadcn/no-unknown-classes': 'error' }
	},
	{
		// static/docs/api is generated typedoc output (see scripts/build-api-docs.mjs).
		ignores: ['node_modules', 'build', '.svelte-kit', 'static/docs/api']
	}
];
