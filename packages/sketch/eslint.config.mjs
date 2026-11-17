import { config } from '@selvajs/config/eslint';

const restrict = (files, patterns) => ({
	files,
	ignores: ['src/**/__tests__/**'],
	rules: { 'no-restricted-imports': ['error', { patterns }] }
});

export default [
	...config,
	restrict(
		['src/model/**/*.ts'],
		[
			{
				group: [
					'three',
					'three/*',
					'rhino3dm',
					'@selvajs/*',
					'../io',
					'../io/*',
					'../tool',
					'../tool/*'
				],
				message: 'model/ is plain data and math: no three, no rhino3dm, no other layer.'
			}
		]
	),
	restrict(
		['src/io/**/*.ts'],
		[
			{
				group: ['three', 'three/*', '@selvajs/*', '../tool', '../tool/*'],
				message: 'io/ runs without a viewer: no three, and it must not import tool/.'
			}
		]
	),
	restrict(
		['src/tool/**/*.ts'],
		[
			{
				group: ['rhino3dm', '../io', '../io/*'],
				message: 'tool/ draws curves and never encodes them: keep rhino3dm and io/ out.'
			}
		]
	)
];
