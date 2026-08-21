import { describe, it, expect } from 'vitest';
import { applySecurityHeaders } from '../security-headers.js';

describe('applySecurityHeaders', () => {
	it('sets the baseline hardening headers and returns the same response', () => {
		const response = new Response('ok');
		const out = applySecurityHeaders(response, { hsts: false });
		expect(out).toBe(response);
		expect(out.headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(out.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
		expect(out.headers.get('Permissions-Policy')).toContain('camera=()');
	});

	it('sets HSTS only when asked (production)', () => {
		const dev = applySecurityHeaders(new Response('ok'), { hsts: false });
		expect(dev.headers.get('Strict-Transport-Security')).toBeNull();

		const prod = applySecurityHeaders(new Response('ok'), { hsts: true });
		expect(prod.headers.get('Strict-Transport-Security')).toBe(
			'max-age=31536000; includeSubDomains'
		);
	});

	it('leaves app routes framable by default (iframe embedding is a product requirement)', () => {
		const out = applySecurityHeaders(new Response('ok'), { hsts: true });
		expect(out.headers.get('Content-Security-Policy')).toBeNull();
		expect(out.headers.get('X-Frame-Options')).toBeNull();
	});

	it('denies framing when the caller opts in (operator surfaces)', () => {
		const out = applySecurityHeaders(new Response('ok'), { hsts: true, denyFraming: true });
		expect(out.headers.get('X-Frame-Options')).toBe('DENY');
		expect(out.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
	});
});
