import sharedConfig from '@selvajs/config/prettier';

/** @type {import('prettier').Config} */
export default {
	...sharedConfig,
	// Override tailwindStylesheet for this package
	tailwindStylesheet: './src/lib/styles/base.css'
};
