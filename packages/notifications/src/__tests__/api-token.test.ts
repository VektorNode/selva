/**
 * The token name is whatever the user typed, and it lands in the HTML part of a
 * mail sent to the token's owner, so it must not be able to inject markup.
 */

import { describe, it, expect } from 'vitest';
import { renderApiTokenCreatedEmail } from '../templates/api-token.js';

const BASE = {
	to: 'owner@acme.test',
	tokenName: 'Felix laptop',
	orgName: 'Acme',
	scopes: ['Read definitions', 'Run solves'],
	expiresAt: '2026-09-01T12:00:00.000Z',
	manageUrl: 'https://selva.test/account/tokens'
};

describe('renderApiTokenCreatedEmail', () => {
	it('puts the manage link in both parts, addressed to the owner', () => {
		const mail = renderApiTokenCreatedEmail(BASE);
		expect(mail.to).toBe(BASE.to);
		expect(mail.kind).toBe('api_token.created');
		expect(mail.text).toContain(BASE.manageUrl);
		expect(mail.html).toContain(`href="${BASE.manageUrl}"`);
	});

	it('names the token and org, and lists every scope', () => {
		const mail = renderApiTokenCreatedEmail(BASE);
		expect(mail.subject).toBe('New API token "Felix laptop" in Acme');
		for (const scope of BASE.scopes) {
			expect(mail.text).toContain(`- ${scope}`);
			expect(mail.html).toContain(`<li>${scope}</li>`);
		}
		expect(mail.text).toContain('September 1, 2026');
	});

	it('escapes markup in the token name, org name and scopes', () => {
		const mail = renderApiTokenCreatedEmail({
			...BASE,
			tokenName: '<img src=x onerror=alert(1)>',
			orgName: '<script>alert(1)</script>',
			scopes: ['"><b>all</b>']
		});
		expect(mail.html).not.toContain('<img src=x');
		expect(mail.html).not.toContain('<script>');
		expect(mail.html).not.toContain('<b>all</b>');
		expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
		expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
	});

	it('escapes an unparseable expiry, which it prints as given', () => {
		const mail = renderApiTokenCreatedEmail({ ...BASE, expiresAt: '<never>' });
		expect(mail.text).toContain('It expires on <never>.');
		expect(mail.html).toContain('&lt;never&gt;');
		expect(mail.html).not.toContain('<never>');
	});

	it('escapes a manage URL that would close the href', () => {
		const mail = renderApiTokenCreatedEmail({
			...BASE,
			manageUrl: 'https://selva.test/t?x="><script>1</script>'
		});
		expect(mail.html).not.toContain('"><script>');
	});
});
