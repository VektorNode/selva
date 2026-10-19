import { describe, it, expect } from 'vitest';
import { isCrossSiteFormSubmission } from '../csrf.js';

const ORIGIN = 'https://selva.test';

function post(path: string, headers: Record<string, string>) {
	return new Request(ORIGIN + path, { method: 'POST', headers, body: 'a=1' });
}

const form = { 'Content-Type': 'application/x-www-form-urlencoded' };

describe('isCrossSiteFormSubmission', () => {
	it('refuses a form post from another origin, or with no origin at all', () => {
		expect(
			isCrossSiteFormSubmission(post('/login', { ...form, Origin: 'https://evil.test' }))
		).toBe(true);
		expect(isCrossSiteFormSubmission(post('/login', form))).toBe(true);
	});

	it('allows a same-origin form post and any JSON post', () => {
		expect(isCrossSiteFormSubmission(post('/login', { ...form, Origin: ORIGIN }))).toBe(false);
		expect(
			isCrossSiteFormSubmission(
				post('/api/v1/x', { 'Content-Type': 'application/json', Origin: 'https://evil.test' })
			)
		).toBe(false);
	});

	it('allows a request carrying Authorization, which a cross-site form cannot set', () => {
		const multipart = { 'Content-Type': 'multipart/form-data; boundary=x' };
		expect(
			isCrossSiteFormSubmission(
				post('/api/v1/definitions', { ...multipart, Authorization: 'Bearer selva_k' })
			)
		).toBe(false);
	});

	it('allows the exempt paths, and only those', () => {
		const opts = { exemptPaths: ['/oauth/token'] };
		expect(isCrossSiteFormSubmission(post('/oauth/token', form), opts)).toBe(false);
		expect(isCrossSiteFormSubmission(post('/oauth/token/x', form), opts)).toBe(true);
	});

	it('ignores safe methods', () => {
		const get = new Request(`${ORIGIN}/login`, {
			headers: { ...form, Origin: 'https://evil.test' }
		});
		expect(isCrossSiteFormSubmission(get)).toBe(false);
	});
});

describe('isCrossSiteFormSubmission with a non-Selva Authorization header', () => {
	it('still checks a form post whose Authorization is not a Selva key', () => {
		expect(
			isCrossSiteFormSubmission(
				post('/login', { ...form, Authorization: 'Bearer eyJhbGciOi.idtoken' })
			)
		).toBe(true);
	});
});
