import sharedConfig from '@selva/config/prettier';

/** @type {import('prettier').Config} */
export default {
	...sharedConfig,
	// Override tailwindStylesheet for this package
	tailwindStylesheet: './src/lib/styles/base.css'
};
