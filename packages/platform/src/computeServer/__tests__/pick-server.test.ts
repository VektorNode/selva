import { describe, expect, it } from 'vitest';
import { pickServer } from '../utils.js';

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
