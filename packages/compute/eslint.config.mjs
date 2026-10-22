import { config } from '@selvajs/config/eslint';

export default [
	...config,
	{
		ignores: ['docs/api/']
	}
];
