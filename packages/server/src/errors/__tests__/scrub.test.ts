import { describe, expect, it } from 'vitest';
import { sampleRate, scrubBreadcrumb, scrubEvent, type ScrubbableEvent } from '../scrub.js';

describe('scrubEvent', () => {
	it('keeps what the request was and drops who sent it and what it carried', () => {
		const event: ScrubbableEvent = {
			request: {
				url: 'https://selva.example/s/abc?token=share-secret',
				cookies: { session: 'x' },
				data: '{"inputs":1}',
				query_string: 'token=share-secret',
				headers: { Authorization: 'Bearer selva_x', Cookie: 'a=b', 'Content-Type': 'text/plain' }
			},
			user: { id: 'u1', email: 'a@b.c', ip_address: '1.2.3.4' },
			breadcrumbs: [
				{ category: 'console', data: { arguments: ['secret'] } },
				{ category: 'fetch', data: { url: '/api/v1/x?key=1', 'http.query': 'key=1' } }
			],
			transaction: 'GET /s/abc?token=share-secret',
			spans: [{ description: 'GET https://h/p?q=1', data: { 'http.url': 'https://h/p?q=1' } }]
		};

		expect(scrubEvent(event)).toEqual({
			request: { url: 'https://selva.example/s/abc', headers: { 'Content-Type': 'text/plain' } },
			user: { id: 'u1' },
			breadcrumbs: [{ category: 'fetch', data: { url: '/api/v1/x' } }],
			transaction: 'GET /s/abc',
			spans: [{ description: 'GET https://h/p', data: { 'http.url': 'https://h/p' } }]
		});
	});

	it('drops console breadcrumbs on their own too', () => {
		expect(scrubBreadcrumb({ category: 'console' })).toBeNull();
	});
});

describe('sampleRate', () => {
	it('reads 0–1, clamps, and treats unset or unreadable as 0', () => {
		expect(sampleRate('0.25')).toBe(0.25);
		expect(sampleRate('4')).toBe(1);
		expect(sampleRate('-1')).toBe(0);
		expect(sampleRate('lots')).toBe(0);
		expect(sampleRate(undefined)).toBe(0);
	});
});
