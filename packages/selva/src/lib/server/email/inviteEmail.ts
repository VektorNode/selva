import type { Mail } from './mailer';

export interface InviteMailInput {
	to: string;
	acceptUrl: string;
	orgName: string;
	/** Display name or email of the admin who minted the invite, when known. */
	invitedBy?: string;
	expiresAt: string;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function formatExpiry(iso: string): string {
	const d = new Date(iso);
	return Number.isNaN(d.getTime())
		? 'soon'
		: d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Renders the invite mail in both parts. Deliberately plain: no images, no
 * tracking pixel, no external stylesheet. Inline styles with a table-free
 * layout survive the common clients, and a mail that degrades to its text
 * part still carries the link.
 */
export function renderInviteEmail(input: InviteMailInput): Mail {
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

	const html = `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;">
	<div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e4e6eb;border-radius:12px;padding:32px;">
		<h1 style="margin:0 0 16px;font-size:20px;font-weight:600;">Join ${escapeHtml(orgName)} on Selva</h1>
		<p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#4a4a4a;">
			${escapeHtml(inviter)} to join <strong>${escapeHtml(orgName)}</strong>. Open the link below to accept and set up your account.
		</p>
		<a href="${escapeHtml(acceptUrl)}" style="display:inline-block;padding:11px 20px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:500;">Accept invitation</a>
		<p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#6b6b6b;">
			Or paste this into your browser:<br />
			<span style="word-break:break-all;color:#4a4a4a;">${escapeHtml(acceptUrl)}</span>
		</p>
		<hr style="border:none;border-top:1px solid #e4e6eb;margin:24px 0;" />
		<p style="margin:0;font-size:12px;line-height:1.5;color:#8a8a8a;">
			This link expires on ${escapeHtml(expiry)} and can only be used once.
			If you weren't expecting this invitation, you can ignore this email.
		</p>
	</div>
</body>
</html>`;

	return { to, subject, text, html };
}
