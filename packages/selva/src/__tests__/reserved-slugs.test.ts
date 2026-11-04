import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RESERVED_SLUGS } from '@selvajs/platform';

const ROUTES = join(dirname(fileURLToPath(import.meta.url)), '..', 'routes');

describe('RESERVED_SLUGS', () => {
	it('matches the top-level route directories, plus the planned /o/ namespace', () => {
		const routes = readdirSync(ROUTES, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && /^[a-z]/.test(entry.name))
			.map((entry) => entry.name);

		expect([...RESERVED_SLUGS].sort()).toEqual([...routes, 'o'].sort());
	});
});
