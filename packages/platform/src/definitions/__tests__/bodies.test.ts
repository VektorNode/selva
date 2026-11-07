import { describe, expect, it } from 'vitest';
import { UpdateMetadataInputSchema } from '../bodies.js';

describe('UpdateMetadataInputSchema', () => {
	it('keeps null, which clears a field, apart from absent, which leaves it alone', () => {
		const parsed = UpdateMetadataInputSchema.parse({
			description: null,
			coverImage: null,
			category: null,
			tags: null,
			computeServerId: null,
			solveCacheLimit: null
		});
		expect(parsed).toEqual({
			description: null,
			coverImage: null,
			category: null,
			tags: null,
			computeServerId: null,
			solveCacheLimit: null
		});
		expect(UpdateMetadataInputSchema.parse({})).toEqual({});
	});

	it('refuses null on a field that cannot be cleared', () => {
		for (const field of ['displayName', 'projectId', 'status']) {
			expect(UpdateMetadataInputSchema.safeParse({ [field]: null }).success, field).toBe(false);
		}
	});

	it.each([
		['displayName', '   '],
		['displayName', 'x'.repeat(257)],
		['description', 'x'.repeat(2001)],
		['coverImage', 'x'.repeat(2049)],
		['category', 'x'.repeat(129)],
		['tags', Array.from({ length: 21 }, (_, i) => `t${i}`)],
		['tags', ['x'.repeat(65)]],
		['solveCacheLimit', -1],
		['solveCacheLimit', 100_001],
		['solveCacheLimit', 1.5],
		['status', 'pending']
	])('refuses %s = %j', (field, value) => {
		expect(UpdateMetadataInputSchema.safeParse({ [field]: value }).success).toBe(false);
	});

	it('accepts each field at its bound', () => {
		const parsed = UpdateMetadataInputSchema.safeParse({
			displayName: 'x'.repeat(256),
			description: 'x'.repeat(2000),
			coverImage: 'x'.repeat(2048),
			category: 'x'.repeat(128),
			tags: Array.from({ length: 20 }, () => 'x'.repeat(64)),
			solveCacheLimit: 100_000
		});
		expect(parsed.success).toBe(true);
	});
});
