import { describe, it, expect } from 'vitest';

import { validateServerUrl } from '../validate-server-url';
import { ComputeError, ErrorCodes } from '@/core/errors';

const expectInvalidConfig = (fn: () => unknown) => {
	try {
		fn();
	} catch (err) {
		expect(err).toBeInstanceOf(ComputeError);
		expect((err as ComputeError).code).toBe(ErrorCodes.INVALID_CONFIG);
		return;
	}
	throw new Error('expected validateServerUrl to throw');
};

describe('validateServerUrl', () => {
	// WHATWG `new URL` trims before parsing; returning the raw string would make every
	// later fetch("http://host /version") throw.
	it.each([
		['http://localhost:6500', 'http://localhost:6500'],
		['https://example.com', 'https://example.com'],
		['http://localhost:6500/', 'http://localhost:6500'],
		['http://localhost:6500///', 'http://localhost:6500'],
		['  http://localhost:6500  ', 'http://localhost:6500'],
		['http://localhost:6500/ \n', 'http://localhost:6500']
	])('normalizes %j to %j', (input, expected) => {
		expect(validateServerUrl(input)).toBe(expected);
	});

	it('rejects empty / whitespace-only URLs', () => {
		expectInvalidConfig(() => validateServerUrl(''));
		expectInvalidConfig(() => validateServerUrl('   '));
		expectInvalidConfig(() => validateServerUrl(undefined as unknown as string));
	});

	it('rejects URLs without an http(s):// scheme', () => {
		expectInvalidConfig(() => validateServerUrl('ftp://example.com'));
		expectInvalidConfig(() => validateServerUrl('example.com'));
		expectInvalidConfig(() => validateServerUrl('ws://localhost:6500'));
	});

	it('rejects the default public McNeel endpoint', () => {
		expectInvalidConfig(() => validateServerUrl('https://compute.rhino3d.com/'));
	});

	// Hostname comparisons are case-insensitive and the trailing-dot
	// FQDN form resolves to the same host — neither may bypass the block.
	it('rejects the public endpoint in casing and trailing-dot FQDN variants', () => {
		expectInvalidConfig(() => validateServerUrl('https://COMPUTE.RHINO3D.COM'));
		expectInvalidConfig(() => validateServerUrl('https://compute.rhino3d.com./'));
		expectInvalidConfig(() => validateServerUrl('http://compute.rhino3d.com.:80/path'));
	});

	// The blocked host is a backend's shared public endpoint, not a property of
	// the transport — a non-Rhino backend names its own (or none).
	it('checks a caller-supplied host list instead of the Rhino default', () => {
		expectInvalidConfig(() =>
			validateServerUrl('https://api.example.com', { blockedHosts: ['api.example.com'] })
		);
		expectInvalidConfig(() =>
			validateServerUrl('https://api.example.com.', { blockedHosts: ['API.Example.com'] })
		);
		expect(
			validateServerUrl('https://compute.rhino3d.com', { blockedHosts: ['api.example.com'] })
		).toBe('https://compute.rhino3d.com');
		expect(validateServerUrl('https://compute.rhino3d.com/', { blockedHosts: [] })).toBe(
			'https://compute.rhino3d.com'
		);
	});

	// URL schemes are case-insensitive per RFC 3986.
	it('accepts an uppercase or mixed-case http(s) scheme', () => {
		expect(validateServerUrl('HTTP://localhost:6500')).toBe('HTTP://localhost:6500');
		expect(validateServerUrl('HttpS://example.com/')).toBe('HttpS://example.com');
	});

	// Endpoint paths are appended to the URL, so query/fragment suffixes
	// would corrupt every request ("…?x=1/version").
	it.each([
		'http://localhost:6500?x=1',
		'http://localhost:6500/?',
		'http://localhost:6500#frag',
		'http://localhost:6500/#'
	])('rejects %s', (url) => {
		expectInvalidConfig(() => validateServerUrl(url));
	});

	// fetch/new Request reject credentialed URLs at runtime, so the
	// validator must reject them up front with a clear message.
	it.each([
		['credentials', 'https://admin:hunter2@my.server'],
		['a query string', 'https://my.server?api_key=hunter2'],
		['a fragment', 'https://my.server#hunter2'],
		['a bad scheme', 'ftp://admin:hunter2@my.server']
	])('keeps the secret out of the error for %s', (_case, url) => {
		let thrown: ComputeError | undefined;
		try {
			validateServerUrl(url);
		} catch (err) {
			thrown = err as ComputeError;
		}
		expect(thrown?.code).toBe(ErrorCodes.INVALID_CONFIG);
		expect(thrown?.message).not.toContain('hunter2');
		expect(JSON.stringify(thrown?.context)).not.toContain('hunter2');
		expect(thrown?.message).toContain('my.server');
	});

	it.each([
		['a slash in the password', 'https://admin:hun/ter2@my.server', 'ter2'],
		['a question mark in the password', 'https://admin:hun?ter2@my.server', 'admin'],
		['a secret in the path', 'https://my.server/hunter2/x?bad', 'hunter2']
	])('reports no more than the origin with %s', (_case, url, secret) => {
		const error = (() => {
			try {
				return validateServerUrl(url);
			} catch (err) {
				return err as ComputeError;
			}
		})() as ComputeError;
		expect(error.code).toBe(ErrorCodes.INVALID_CONFIG);
		expect(error.message).not.toContain(secret);
		expect(JSON.stringify(error.context)).not.toContain(secret);
	});

	it('rejects credentials embedded in the URL', () => {
		expectInvalidConfig(() => validateServerUrl('http://user:pass@localhost:6500'));
		expectInvalidConfig(() => validateServerUrl('http://user@localhost:6500'));
		try {
			validateServerUrl('http://user:pass@localhost:6500');
			throw new Error('expected validateServerUrl to throw');
		} catch (err) {
			expect((err as Error).message).toMatch(/credentials/i);
		}
	});

	it('accepts IPv6 literal hosts', () => {
		expect(validateServerUrl('http://[::1]:6500')).toBe('http://[::1]:6500');
	});
});

describe('validateServerUrl — long runs', () => {
	// `/x+$/` retries from every position of a run, so these took seconds when trimmed by regex.
	it('trims a URL holding long runs of slashes and dots in linear time', () => {
		const started = performance.now();
		expect(validateServerUrl('http://h/' + '/'.repeat(200_000) + 'a')).toMatch(/a$/);
		expect(validateServerUrl('http://h' + '/'.repeat(200_000))).toBe('http://h');
		expect(() =>
			validateServerUrl('http://compute.rhino3d.com' + '.'.repeat(100_000))
		).toThrowError(ComputeError);
		expect(performance.now() - started).toBeLessThan(1000);
	});
});
