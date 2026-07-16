import { describe, it, expect } from 'vitest';
import { SlugSchema, RESERVED_SLUGS } from '../schemas.js';

/**
 * Reserved-slug guard (audit D4). A tenant slug must never equal a top-level
 * route segment, or it could shadow (or be shadowed by) a route once flat
 * tenant URLs — `/o/{slug}/…` per ADR 0006 — exist. These tests pin that the
 * guard rejects every reserved word and still accepts ordinary slugs, so the
 * reservation can't silently regress before the multi-org routing is built.
 */
describe('SlugSchema', () => {
	it('accepts a normal lowercase-hyphenated slug', () => {
		expect(SlugSchema.safeParse('acme-studio').success).toBe(true);
	});

	it('rejects every reserved slug', () => {
		for (const reserved of RESERVED_SLUGS) {
			const result = SlugSchema.safeParse(reserved);
			expect(result.success, `"${reserved}" must be rejected`).toBe(false);
		}
	});

	it('reserves the multi-org namespace prefix `o` even though the length gate already blocks it', () => {
		// `o` is 1 char, so `min(3)` rejects it regardless — but it stays in the
		// reserved set so intent survives any future relaxation of the length rule.
		expect(RESERVED_SLUGS).toContain('o');
		expect(SlugSchema.safeParse('o').success).toBe(false);
	});

	it('still enforces the format rules (length, charset)', () => {
		expect(SlugSchema.safeParse('ab').success).toBe(false); // too short
		expect(SlugSchema.safeParse('-lead').success).toBe(false); // leading hyphen
		expect(SlugSchema.safeParse('UPPER').success).toBe(false); // uppercase
		expect(SlugSchema.safeParse('a'.repeat(64)).success).toBe(false); // too long
	});

	it('does not over-reject: a slug that merely contains a reserved word is fine', () => {
		// The guard is exact-match, not substring — `team-alpha` is not `team`.
		expect(SlugSchema.safeParse('team-alpha').success).toBe(true);
		expect(SlugSchema.safeParse('my-api').success).toBe(true);
	});
});
