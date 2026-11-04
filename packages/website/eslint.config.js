import { createConfig } from '@selvajs/config/eslint';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default [
	...createConfig(__dirname),
	{
		// The marketing site draws its own large, soft cards; only the colour roles apply here.
		files: ['**/*.svelte', '**/*.ts'],
		rules: { 'selva/surface-roles': ['error', { radius: false }] }
	},
	{
		// static/docs/api is generated typedoc output (see scripts/build-api-docs.mjs).
		ignores: ['node_modules', 'build', '.svelte-kit', 'static/docs/api']
	}
];
