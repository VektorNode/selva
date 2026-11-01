import { describe, expect, it } from 'vitest';
import { GuidSchema } from '../schemas.js';

describe('GuidSchema', () => {
	it('normalizes to lowercase, since local keys by raw string and Postgres does not', () => {
		const upper = 'ABCDEF12-1111-4111-8111-111111111111';
		expect(GuidSchema.parse(upper)).toBe(upper.toLowerCase());
	});

	it.each(['__proto__', 'constructor', 'not-a-guid'])('still refuses %s', (value) => {
		expect(GuidSchema.safeParse(value).success).toBe(false);
	});
});
