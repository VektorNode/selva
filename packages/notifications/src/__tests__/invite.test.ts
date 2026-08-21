/**
 * The invite mail must carry a working link in BOTH parts and must not let an
 * org name or inviter label inject markup into the HTML part.
 */

import { describe, it, expect } from 'vitest';
import { renderInviteEmail } from '../templates/invite.js';

const BASE = {
	to: 'newhire@acme.test',
	acceptUrl: 'https://selva.test/accept-invite?token=invite_abc123',
	orgName: 'Acme',
	expiresAt: '2026-09-01T12:00:00.000Z'
};

describe('renderInviteEmail', () => {
	it('puts the accept link in both the text and html parts', () => {
		const mail = renderInviteEmail(BASE);
		expect(mail.text).toContain(BASE.acceptUrl);
		expect(mail.html).toContain(BASE.acceptUrl);
		expect(mail.to).toBe(BASE.to);
	});

	it('tags the message with its kind so the dispatcher can route it', () => {
		expect(renderInviteEmail(BASE).kind).toBe('org.invite');
	});

	it('names the org and the inviter in the subject', () => {
		const mail = renderInviteEmail({ ...BASE, invitedBy: 'Alice' });
		expect(mail.subject).toContain('Acme');
		expect(mail.subject).toContain('Alice');
	});

	it('falls back to an impersonal subject when the inviter is unknown', () => {
		const mail = renderInviteEmail(BASE);
		expect(mail.subject).toContain('You have been invited');
		expect(mail.subject).toContain('Acme');
	});

	it('escapes markup in the org name and inviter label', () => {
		const mail = renderInviteEmail({
			...BASE,
			orgName: '<script>alert(1)</script>',
			invitedBy: '"><img src=x>'
		});
		expect(mail.html).not.toContain('<script>alert(1)</script>');
		expect(mail.html).not.toContain('<img src=x>');
		expect(mail.html).toContain('&lt;script&gt;');
	});

	it('escapes the accept url, which carries an attacker-influenced token', () => {
		const mail = renderInviteEmail({
			...BASE,
			acceptUrl: 'https://selva.test/accept-invite?token="><img src=x>'
		});
		expect(mail.html).not.toContain('<img src=x>');
	});

	it('states the expiry rather than printing a raw ISO string', () => {
		const mail = renderInviteEmail(BASE);
		expect(mail.text).not.toContain('2026-09-01T12:00:00.000Z');
		expect(mail.text).toMatch(/expires on .+2026/);
	});

	it('degrades to "soon" on an unparseable expiry instead of printing NaN', () => {
		const mail = renderInviteEmail({ ...BASE, expiresAt: 'not-a-date' });
		expect(mail.text).toContain('soon');
		expect(mail.text).not.toContain('NaN');
		expect(mail.html).not.toContain('Invalid Date');
	});
});
