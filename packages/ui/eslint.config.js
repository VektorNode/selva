import { createConfig } from '@selvajs/config/eslint';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default [
	...createConfig(__dirname),
	{
		// The design system itself holds no violations, so a new one fails the lint here.
		files: ['**/*.svelte', '**/*.ts'],
		rules: {
			'shadcn/no-raw-colors': 'error',
			'shadcn/no-arbitrary-values': 'error',
			'shadcn/no-unknown-classes': 'error',
			'shadcn/no-inline-styles': 'error',
			'shadcn/no-restyle': ['error', { allow: ['layout'] }]
		}
	},
	{
		files: ['**/components/primitives/**'],
		rules: { 'shadcn/no-restyle': 'off' }
	}
];
