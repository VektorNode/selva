import { describe, expect, it } from 'vitest';
import { clampRetryCount, clampTimeoutMs, pickServer, resolveServerForOrg } from '../utils.js';
import type { ComputeConfig } from '../types.js';

const a = { id: 'a' };
const b = { id: 'b' };

describe('pickServer', () => {
	it('prefers a visible pin, then the default, then the first', () => {
		expect(pickServer([a, b], 'a', 'b')).toBe(b);
		expect(pickServer([a, b], 'b', 'gone')).toBe(b);
		expect(pickServer([a, b], 'gone', null)).toBe(a);
	});

	it('finds nothing in an empty list', () => {
		expect(pickServer([], 'a', 'b')).toBeUndefined();
	});
});

describe('resolveServerForOrg', () => {
	it('throws when nothing is visible', () => {
		const config: ComputeConfig = { servers: [] };
		expect(() => resolveServerForOrg(config, 'acme')).toThrow(/No compute servers/);
	});
});

describe('compute form clamps', () => {
	it('keeps a timeout in range and defaults junk', () => {
		expect(clampTimeoutMs('5000')).toBe(5000);
		expect(clampTimeoutMs(1)).toBe(1000);
		expect(clampTimeoutMs(9e9)).toBe(300000);
		expect(clampTimeoutMs('junk')).toBe(30000);
	});

	it('keeps a retry count in range', () => {
		expect(clampRetryCount(9)).toBe(5);
		expect(clampRetryCount(-1)).toBe(0);
		expect(clampRetryCount('junk')).toBe(0);
	});
});
