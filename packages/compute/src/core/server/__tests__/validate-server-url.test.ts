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
	it('accepts a well-formed http(s) URL and returns it normalized', () => {
		expect(validateServerUrl('http://localhost:6500')).toBe('http://localhost:6500');
		expect(validateServerUrl('https://example.com')).toBe('https://example.com');
	});

	it('strips trailing slashes', () => {
		expect(validateServerUrl('http://localhost:6500/')).toBe('http://localhost:6500');
		expect(validateServerUrl('http://localhost:6500///')).toBe('http://localhost:6500');
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
	it('blocks a caller-supplied host list instead of the Rhino default', () => {
		expectInvalidConfig(() =>
			validateServerUrl('https://api.example.com', { blockedHosts: ['api.example.com'] })
		);
		expect(
			validateServerUrl('https://compute.rhino3d.com', { blockedHosts: ['api.example.com'] })
		).toBe('https://compute.rhino3d.com');
	});

	it('blocks nothing when given an empty host list', () => {
		expect(validateServerUrl('https://compute.rhino3d.com/', { blockedHosts: [] })).toBe(
			'https://compute.rhino3d.com'
		);
	});

	it('normalizes caller-supplied hosts the same way as the parsed hostname', () => {
		expectInvalidConfig(() =>
			validateServerUrl('https://api.example.com.', { blockedHosts: ['API.Example.com'] })
		);
	});

	// URL schemes are case-insensitive per RFC 3986.
	it('accepts an uppercase or mixed-case http(s) scheme', () => {
		expect(validateServerUrl('HTTP://localhost:6500')).toBe('HTTP://localhost:6500');
		expect(validateServerUrl('HttpS://example.com/')).toBe('HttpS://example.com');
	});

	// Endpoint paths are appended to the URL, so query/fragment suffixes
	// would corrupt every request ("…?x=1/version").
	it('rejects URLs with a query string', () => {
		expectInvalidConfig(() => validateServerUrl('http://localhost:6500?x=1'));
		expectInvalidConfig(() => validateServerUrl('http://localhost:6500/?'));
	});

	it('rejects URLs with a fragment', () => {
		expectInvalidConfig(() => validateServerUrl('http://localhost:6500#frag'));
		expectInvalidConfig(() => validateServerUrl('http://localhost:6500/#'));
	});

	it('explains why query/fragment URLs are rejected', () => {
		try {
			validateServerUrl('http://localhost:6500?x=1');
			throw new Error('expected validateServerUrl to throw');
		} catch (err) {
			expect((err as Error).message).toMatch(/query string or fragment/i);
		}
	});

	// WHATWG `new URL` trims before parsing; returning the raw string would make every
	// later fetch("http://host /version") throw.
	it('trims surrounding whitespace and returns the trimmed form', () => {
		expect(validateServerUrl('  http://localhost:6500  ')).toBe('http://localhost:6500');
		expect(validateServerUrl('http://localhost:6500/ \n')).toBe('http://localhost:6500');
	});

	// fetch/new Request reject credentialed URLs at runtime, so the
	// validator must reject them up front with a clear message.
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
