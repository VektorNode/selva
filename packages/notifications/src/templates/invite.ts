import type { OutboundMessage } from '@selvajs/platform/notifications';
import { escapeHtml } from '../html.js';
import { renderButton, renderLayout, renderUrlFallback } from '../layout.js';

export interface InviteMailInput {
	to: string;
	acceptUrl: string;
	orgName: string;
	/** Display name or email of the admin who minted the invite, when known. */
	invitedBy?: string;
	expiresAt: string;
}

function formatExpiry(iso: string): string {
	const d = new Date(iso);
	return Number.isNaN(d.getTime())
		? 'soon'
		: d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * "An admin invited you to an org" — the mail carrying an invite's accept link.
 *
 * The text part must always carry the URL: a mail that degrades to plain text
 * is still the only way the invitee can accept.
 */
export function renderInviteEmail(input: InviteMailInput): OutboundMessage {
	const { to, acceptUrl, orgName, invitedBy } = input;
	const expiry = formatExpiry(input.expiresAt);
	const inviter = invitedBy ? `${invitedBy} invited you` : 'You have been invited';

	const subject = `${inviter} to join ${orgName} on Selva`;

	const text = [
		`${inviter} to join ${orgName} on Selva.`,
		'',
		'Open this link to accept and set up your account:',
		acceptUrl,
		'',
		`The link expires on ${expiry} and can only be used once.`,
		'',
		"If you weren't expecting this invitation, you can ignore this email."
	].join('\n');

	const html = renderLayout({
		heading: `Join ${orgName} on Selva`,
		body: `		<p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#4a4a4a;">
			${escapeHtml(inviter)} to join <strong>${escapeHtml(orgName)}</strong>. Open the link below to accept and set up your account.
		</p>
		${renderButton(acceptUrl, 'Accept invitation')}
		${renderUrlFallback(acceptUrl)}`,
		footer: `This link expires on ${escapeHtml(expiry)} and can only be used once.
			If you weren't expecting this invitation, you can ignore this email.`
	});

	return { kind: 'org.invite', to, subject, text, html };
}
