import { config } from '@selvajs/config/eslint';

export default [
	...config,
	{
		ignores: ['docs/api/']
	},
	{
		// CLI maintenance scripts — console output is their interface.
		files: ['scripts/**/*.mjs'],
		rules: {
			'no-console': 'off'
		}
	}
];
