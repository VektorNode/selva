import { config } from '@selvajs/config/eslint';

/**
 * scene/, render/ and parse/ are sibling layers: each may import shared/, none imports another.
 * Tests are exempt: a parse test that reads its output back through scene's getTrackingKey pins
 * the seam between the two, which is the point of keeping them apart.
 */
const LAYERS = ['scene', 'render', 'parse'];

const layerBoundaries = LAYERS.map((layer) => {
	const siblings = LAYERS.filter((other) => other !== layer);
	return {
		files: [`src/${layer}/**/*.ts`],
		ignores: ['src/**/__tests__/**'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: siblings.flatMap((other) => [`**/${other}`, `**/${other}/**`]),
							message: `${layer}/ must not import ${siblings.join('/ or ')}/: the layers are siblings. Move what both need into shared/.`
						}
					]
				}
			]
		}
	};
});

export default [
	...config,
	...layerBoundaries,
	{
		// Node CLI scripts report through stdout.
		files: ['lab/**/*.mjs'],
		rules: { 'no-console': 'off' }
	}
];
