import { describe, it, expect } from 'vitest';

import { validateServerUrl } from '../validate-server-url';
import { RhinoComputeError, ErrorCodes } from '@/core/errors';

const expectInvalidConfig = (fn: () => unknown) => {
	try {
		fn();
	} catch (err) {
		expect(err).toBeInstanceOf(RhinoComputeError);
		expect((err as RhinoComputeError).code).toBe(ErrorCodes.INVALID_CONFIG);
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

	// Scheme check — previously enforced by ComputeServerStats but MISSING from the
	// client's validator. Unifying must enforce it on both paths.
	it('rejects URLs without an http(s):// scheme', () => {
		expectInvalidConfig(() => validateServerUrl('ftp://example.com'));
		expectInvalidConfig(() => validateServerUrl('example.com'));
		expectInvalidConfig(() => validateServerUrl('ws://localhost:6500'));
	});

	// Public-endpoint check — previously enforced by the client but MISSING from
	// ComputeServerStats. Unifying must enforce it on both paths.
	it('rejects the default public McNeel endpoint', () => {
		expectInvalidConfig(() => validateServerUrl('https://compute.rhino3d.com/'));
	});

	// Issue 112: hostname comparisons are case-insensitive and the trailing-dot
	// FQDN form resolves to the same host — neither may bypass the block.
	it('rejects the public endpoint in casing and trailing-dot FQDN variants', () => {
		expectInvalidConfig(() => validateServerUrl('https://COMPUTE.RHINO3D.COM'));
		expectInvalidConfig(() => validateServerUrl('https://compute.rhino3d.com./'));
		expectInvalidConfig(() => validateServerUrl('http://compute.rhino3d.com.:80/path'));
	});

	// Issue 112: URL schemes are case-insensitive per RFC 3986.
	it('accepts an uppercase or mixed-case http(s) scheme', () => {
		expect(validateServerUrl('HTTP://localhost:6500')).toBe('HTTP://localhost:6500');
		expect(validateServerUrl('HttpS://example.com/')).toBe('HttpS://example.com');
	});

	// Issue 97: endpoint paths are appended to the URL, so query/fragment suffixes
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

	// Issue 98: WHATWG `new URL` trims before parsing, but the raw string was
	// returned — every later fetch("http://host /version") then threw.
	it('trims surrounding whitespace and returns the trimmed form', () => {
		expect(validateServerUrl('  http://localhost:6500  ')).toBe('http://localhost:6500');
		expect(validateServerUrl('http://localhost:6500/ \n')).toBe('http://localhost:6500');
	});

	// Issue 98: fetch/new Request reject credentialed URLs at runtime, so the
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
