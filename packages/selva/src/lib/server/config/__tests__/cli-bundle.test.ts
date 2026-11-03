import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_SETTINGS } from '../settings.js';

// A variable path keeps the plain-JS bundle out of type-checking.
const BUNDLE = fileURLToPath(
	new URL('../../../../../../cli/src/generated/config.js', import.meta.url)
);

describe('the CLI’s bundled manifest', () => {
	it('matches the source. Out of date: pnpm --filter @selvajs/selva generate:cli-config', async () => {
		const bundled = (await import(/* @vite-ignore */ BUNDLE)) as { ALL_SETTINGS: unknown };
		expect(JSON.stringify(bundled.ALL_SETTINGS)).toBe(JSON.stringify(ALL_SETTINGS));
	});
});
