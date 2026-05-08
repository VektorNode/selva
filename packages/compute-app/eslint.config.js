import { createConfig } from '@selvajs/config/eslint';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default [
	...createConfig(__dirname),
	{
		languageOptions: {
			globals: {
				__GIT_HASH__: 'readonly',
				__GIT_SHORT_HASH__: 'readonly',
				__GIT_MESSAGE__: 'readonly',
				__GIT_DATE__: 'readonly'
			}
		}
	}
];
