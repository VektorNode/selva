import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createVitestConfig } from '@selvajs/config/vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default createVitestConfig({
	test: {
		setupFiles: ['./tests/setup.ts']
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
			'@tests': path.resolve(__dirname, './tests')
		}
	}
});
