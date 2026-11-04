import * as path from 'node:path';

import { createVitestConfig } from '@selvajs/config/vitest';

export default createVitestConfig({
	test: {
		setupFiles: ['./tests/setup.ts'],
		clearMocks: true
	},
	resolve: {
		alias: {
			'@': path.resolve(import.meta.dirname, './src'),
			'@tests': path.resolve(import.meta.dirname, './tests')
		}
	}
});
