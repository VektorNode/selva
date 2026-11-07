import { svelte } from '@sveltejs/vite-plugin-svelte';

import { createVitestConfig } from '@selvajs/config/vitest';

// Two projects. `logic` runs the pure schema/logic modules under node. `runes` runs
// `*.svelte.test.ts`: rune modules compiled for the client, with `svelte` resolved to its browser
// build, because the server build never runs `$effect` and those modules live in their effects.
// Neither mounts components: no DOM, no Tailwind or kit pipeline.
export default createVitestConfig({
	plugins: [svelte()],
	test: {
		projects: [
			{ extends: true, test: { name: 'logic', exclude: ['**/*.svelte.test.ts'] } },
			{
				extends: true,
				resolve: { conditions: ['browser'] },
				test: {
					name: 'runes',
					include: ['src/**/*.svelte.test.ts'],
					environment: './src/test/runes-environment.ts'
				}
			}
		]
	}
});
