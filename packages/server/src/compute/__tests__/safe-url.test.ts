import { describe, it, expect } from 'vitest';
import { isSafeRemoteDefinitionUrl } from '../safe-url.js';

/**
 * Each rejection row is an attack the guard exists to block: unblocked, any of
 * them lets an authenticated user have the server fetch arbitrary
 * intranet/cloud-metadata/loopback hosts on their behalf.
 *
 * Hostname and IP literals only — DNS rebinding is out of scope here, and the
 * resolve-then-check layer lives in `assertSafeRemoteDefinitionUrl`.
 */
describe('isSafeRemoteDefinitionUrl', () => {
	it.each([
		'https://example.com/foo.gh',
		'http://example.com/foo.gh',
		'https://cdn.example.com:443/path/to/file.ghx',
		'https://1.2.3.4/file.gh',
		// 172.32 is outside the 172.16-31 private range — must be allowed.
		'https://172.32.0.1/file.gh',
		// Edge of the private /16 — 192.169 is public.
		'https://192.169.0.1/file.gh'
	])('accepts public URL %j', (url) => {
		expect(isSafeRemoteDefinitionUrl(url)).toBe(true);
	});

	it.each([
		// Loopback
		['http://localhost/foo', 'localhost'],
		['http://localhost:8080/foo', 'localhost with port'],
		['http://api.localhost/foo', '*.localhost'],
		['http://127.0.0.1/foo', '127.0.0.1'],
		['http://127.0.0.5/foo', '127/8'],
		['http://0.0.0.0/foo', '0.0.0.0'],
		['http://[::1]/foo', 'IPv6 loopback'],
		// Cloud metadata service — the canonical reason this guard exists.
		['http://169.254.169.254/latest/meta-data/', 'AWS/GCP/Azure metadata'],
		['http://169.254.0.1/foo', '169.254/16 link-local'],
		// IPv4 RFC1918 private ranges
		['http://10.0.0.1/foo', '10/8'],
		['http://10.255.255.255/foo', '10/8 upper'],
		['http://192.168.0.1/foo', '192.168/16'],
		['http://172.16.0.1/foo', '172.16 lower bound'],
		['http://172.31.255.255/foo', '172.31 upper bound'],
		['http://172.20.0.1/foo', '172.20 mid-range'],
		// IPv6 unique-local + link-local
		['http://[fc00::1]/foo', 'IPv6 unique-local fc'],
		['http://[fd12:3456::1]/foo', 'IPv6 unique-local fd'],
		['http://[fe80::1]/foo', 'IPv6 link-local'],
		// IPv4-mapped IPv6 — must unwrap and apply the v4 rules.
		['http://[::ffff:127.0.0.1]/foo', 'IPv4-mapped loopback'],
		['http://[::ffff:169.254.169.254]/foo', 'IPv4-mapped metadata'],
		['http://[::ffff:10.0.0.1]/foo', 'IPv4-mapped RFC1918'],
		// Alternate IPv4 encodings that glibc/inet_aton resolve to loopback.
		['http://2130706433/foo', 'integer loopback'],
		['http://0x7f000001/foo', 'hex loopback'],
		['http://0177.0.0.1/foo', 'octal loopback'],
		['http://127.1/foo', 'short-form loopback'],
		['http://0/foo', 'integer 0.0.0.0'],
		// Alternate encodings of the cloud-metadata address.
		['http://2852039166/foo', 'integer metadata 169.254.169.254'],
		// Non-http(s) schemes
		['file:///etc/passwd', 'file scheme'],
		['gopher://evil/', 'gopher scheme'],
		['javascript:alert(1)', 'javascript scheme'],
		// Malformed
		['not a url', 'unparseable'],
		['', 'empty']
	])('rejects %j (%s)', (url) => {
		expect(isSafeRemoteDefinitionUrl(url)).toBe(false);
	});
});
