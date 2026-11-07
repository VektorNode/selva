import { describe, expect, it } from 'vitest';
import { orgPaths } from '../../organizations/paths.js';
import { classifyAssetPath } from '../assetClasses.js';
import { assertSafeKey } from '../safeKey.js';

describe('assertSafeKey', () => {
	it.each(['acme', 'a.b_c-1', '11111111-1111-4111-8111-111111111111'])('accepts %j', (value) => {
		expect(() => assertSafeKey(value, 'id')).not.toThrow();
	});

	it.each(['', '.', '..', 'a/b', 'a\\b', '../x', 'a\0b', 'a b', 'ü'])('refuses %j', (value) => {
		expect(() => assertSafeKey(value, 'id')).toThrow(/^Unsafe id/);
	});
});

describe('a path no write can produce', () => {
	it.each(['..', '.', ''])('is refused on write for the org id %j', (id) => {
		expect(() => orgPaths.asset(id, 'logo')).toThrow(/Unsafe orgId/);
	});

	it.each([
		'orgs/../branding/logo.webp',
		'orgs/./branding/logo.webp',
		'orgs//branding/logo.webp',
		'orgs/a\\b/branding/logo.webp'
	])('is never classified for reading: %j', (path) => {
		expect(classifyAssetPath(path)).toBeNull();
	});
});
