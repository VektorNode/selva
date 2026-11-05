import { config } from '@selvajs/config/eslint';

export default [
	...config,
	{
		// Node CLI scripts report through stdout.
		files: ['lab/**/*.mjs'],
		rules: { 'no-console': 'off' }
	}
];
