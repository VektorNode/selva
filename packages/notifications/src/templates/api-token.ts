import type { OutboundMessage } from '@selvajs/platform/notifications';
import { escapeHtml } from '../html.js';
import { renderButton, renderLayout, renderUrlFallback } from '../layout.js';

export interface ApiTokenCreatedMailInput {
	to: string;
	tokenName: string;
	orgName: string;
	/** Already in plain words, one per scope. */
	scopes: string[];
	expiresAt: string;
	/** Where the owner can see and revoke the key. */
	manageUrl: string;
}

function formatDate(iso: string): string {
	const d = new Date(iso);
	return Number.isNaN(d.getTime())
		? iso
		: d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * "A new API token was created on your account". The point is the case where
 * the owner didn't create it, so the revoke link leads.
 */
export function renderApiTokenCreatedEmail(input: ApiTokenCreatedMailInput): OutboundMessage {
	const { to, tokenName, orgName, scopes, manageUrl } = input;
	const expiry = formatDate(input.expiresAt);
	const subject = `New API token "${tokenName}" in ${orgName}`;

	const text = [
		`A new API token named "${tokenName}" was created on your Selva account in ${orgName}.`,
		'',
		'It can:',
		...scopes.map((s) => `- ${s}`),
		'',
		`It expires on ${expiry}.`,
		'',
		"If you didn't create it, revoke it now:",
		manageUrl
	].join('\n');

	const html = renderLayout({
		heading: 'New API token',
		body: `		<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#4a4a4a;">
			A new API token named <strong>${escapeHtml(tokenName)}</strong> was created on your account in <strong>${escapeHtml(orgName)}</strong>. It can:
		</p>
		<ul style="margin:0 0 24px;padding-left:20px;font-size:15px;line-height:1.5;color:#4a4a4a;">
			${scopes.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
		</ul>
		${renderButton(manageUrl, 'Review your tokens')}
		${renderUrlFallback(manageUrl)}`,
		footer: `It expires on ${escapeHtml(expiry)}. If you didn't create it, revoke it from the page above.`
	});

	return { kind: 'api_token.created', to, subject, text, html };
}
