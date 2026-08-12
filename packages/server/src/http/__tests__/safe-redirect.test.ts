import { describe, it, expect } from 'vitest';
import { safeRedirectTarget } from '../redirect.js';

/**
 * Each rejection row is a value that would otherwise smuggle an external host
 * into a post-login `redirect(303, …)` — including the back-slash variants some
 * browsers normalize into a path separator.
 */
describe('safeRedirectTarget', () => {
	it.each([
		['/foo', '/foo'],
		['/foo/bar', '/foo/bar'],
		['/foo?x=1', '/foo?x=1'],
		['/foo#frag', '/foo#frag'],
		['/a', '/a'] // shortest valid path: `/` + non-`/` char
	])('accepts same-origin path %j → %j', (input, expected) => {
		expect(safeRedirectTarget(input, '/fallback')).toBe(expected);
	});

	it.each([
		['//evil.com', 'protocol-relative URL'],
		['//evil.com/path', 'protocol-relative URL with path'],
		['/\\evil.com', 'back-slash bypass'],
		['https://evil.com', 'absolute URL'],
		['http://evil.com', 'absolute URL'],
		['javascript:alert(1)', 'javascript: scheme'],
		['', 'empty string'],
		['/', 'lone slash (length<2)'],
		['evil.com', 'no leading slash'],
		['./relative', 'relative path']
	])('rejects %j (%s)', (input) => {
		expect(safeRedirectTarget(input, '/fallback')).toBe('/fallback');
	});

	it.each([null, undefined])('rejects %j', (input) => {
		expect(safeRedirectTarget(input, '/fallback')).toBe('/fallback');
	});

	it('passes through arbitrary non-string types as fallback', () => {
		// The signature says `string | null | undefined`, but call sites hand it
		// `unknown` straight from FormData — hence the cast and the runtime guard.
		expect(safeRedirectTarget(42 as unknown as string, '/fallback')).toBe('/fallback');
	});
});
