import { config } from '../config/eslint.config.js';

export default [
	...config,
	{
		// CLI maintenance scripts — console output is their interface.
		files: ['scripts/**/*.mjs'],
		rules: {
			'no-console': 'off'
		}
	}
];
