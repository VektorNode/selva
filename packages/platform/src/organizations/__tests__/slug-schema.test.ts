import { describe, it, expect } from 'vitest';
import {
	CreateOrgSchema,
	SlugSchema,
	RESERVED_SLUGS,
	orgSlugFromName,
	slugify
} from '../schemas.js';

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

describe('slugify', () => {
	it('lowercases, trims, and hyphenates non-alphanumeric runs', () => {
		expect(slugify('  Acme Studio!! ')).toBe('acme-studio');
		expect(slugify('Foo___Bar / Baz')).toBe('foo-bar-baz');
	});

	it('strips leading and trailing hyphens', () => {
		expect(slugify('---hello---')).toBe('hello');
		expect(slugify('!leading and trailing.')).toBe('leading-and-trailing');
	});

	it('caps output at 63 characters', () => {
		expect(slugify('a'.repeat(100))).toHaveLength(63);
	});

	it('yields an empty string when nothing survives (caller must still validate)', () => {
		expect(slugify('!!!')).toBe('');
		// It does not itself guarantee validity — the output must pass SlugSchema.
		expect(SlugSchema.safeParse(slugify('!!!')).success).toBe(false);
	});

	it('produces slugs that SlugSchema accepts for ordinary names', () => {
		expect(SlugSchema.safeParse(slugify('Acme Studio')).success).toBe(true);
	});
});

describe('slugify', () => {
	it('never ends in a hyphen after cutting to length', () => {
		const slug = slugify(`${'a'.repeat(62)} b`);
		expect(slug).toBe('a'.repeat(62));
		expect(SlugSchema.safeParse(slug).success).toBe(true);
	});

	it('folds accents instead of turning them into hyphens', () => {
		expect(slugify('Müller GmbH')).toBe('muller-gmbh');
		expect(slugify('Crème Brûlée')).toBe('creme-brulee');
	});

	it('gives up on a name with no latin letters or digits', () => {
		expect(slugify('日本')).toBe('');
	});
});

describe('orgSlugFromName', () => {
	it('keeps a valid slug', () => {
		expect(orgSlugFromName('Acme Studio')).toBe('acme-studio');
	});

	it('moves off a reserved word', () => {
		expect(orgSlugFromName('Admin')).toBe('admin-org');
		expect(SlugSchema.safeParse(orgSlugFromName('Admin')).success).toBe(true);
	});

	it('falls back when the name yields too little', () => {
		expect(orgSlugFromName('日本')).toBe('default');
		expect(orgSlugFromName('ab')).toBe('default');
	});
});

describe('name schemas', () => {
	it('refuses a name of only whitespace', () => {
		expect(CreateOrgSchema.safeParse({ name: '   ', slug: 'acme' }).success).toBe(false);
	});

	it('trims a real name', () => {
		expect(CreateOrgSchema.parse({ name: '  Acme  ', slug: 'acme' }).name).toBe('Acme');
	});
});
