import { config } from '@selvajs/config/eslint';

export default [
	...config,

	/**
	 * The client/server boundary.
	 *
	 * `client/` ships to a browser. A single import reaching into `server/` — or into anything
	 * server-only it depends on — pulls storage credentials and `process.env` reads into a client
	 * bundle. The no-root-barrel decision in `tsdown.config.ts` stops a *consumer* from crossing the
	 * line; this stops the package itself from crossing it internally, in-editor, before a bundle
	 * exists to test.
	 */
	{
		files: ['src/client/**/*.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['../server', '../server/*', '**/server/**'],
							message:
								'client/ must never import server/ — it would pull server-only code into a browser bundle. Put anything both halves need in shared/.'
						},
						{
							group: [
								'@selvajs/platform',
								'@selvajs/platform/*',
								'@selvajs/server',
								'@selvajs/server/*',
								'node:*'
							],
							message:
								'client/ runs in a browser: no platform providers, no server plumbing, no node builtins.'
						}
					]
				}
			]
		}
	}
];
