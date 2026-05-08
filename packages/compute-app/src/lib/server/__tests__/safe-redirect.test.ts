import { describe, it, expect } from 'vitest';
import { safeRedirectTarget } from '../admin-auth.server.js';

/**
 * `safeRedirectTarget` is the post-login redirect validator. The point of
 * the function is to reject *exactly* the values that would otherwise
 * smuggle an external host into a SvelteKit `redirect(303, …)` call:
 * protocol-relative URLs (`//evil.com`) and back-slash variants some
 * browsers normalize as a path separator. Each row below is one such case.
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
		// safeRedirectTarget's signature is `string | null | undefined`, but
		// some call sites get `unknown` from FormData — make sure we don't
		// throw on a stray non-string.
		expect(safeRedirectTarget(42 as unknown as string, '/fallback')).toBe('/fallback');
	});
});
