import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComputeServerStats } from '@selvajs/compute/grasshopper';

import { openServerStats } from '../serverStats.server';

describe('openServerStats', () => {
	afterEach(() => vi.restoreAllMocks());

	it('opens stats for a usable server', () => {
		const opened = openServerStats('http://localhost:6500', 'key');
		expect(opened.stats).toBeInstanceOf(ComputeServerStats);
	});

	it('reports a stored key that cannot be sent, without quoting it', () => {
		const opened = openServerStats('http://localhost:6500', 'super-secret\nkey');
		expect(opened.stats).toBeUndefined();
		expect(opened.misconfigured).toMatch(/header/i);
		expect(opened.misconfigured).not.toContain('super-secret');
	});

	it('reports a stored URL that cannot be used', () => {
		const opened = openServerStats('not a url', undefined);
		expect(opened.stats).toBeUndefined();
		expect(opened.misconfigured).toMatch(/serverUrl/);
	});
});
