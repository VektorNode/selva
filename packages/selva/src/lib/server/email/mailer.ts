import type { ILogger } from '@selvajs/platform';
import { readSmtpConfig } from './config';
import { getLogger } from '$lib/server/providers.server';

export interface Mail {
	to: string;
	subject: string;
	text: string;
	html: string;
}

export type SendResult =
	{ status: 'sent' } | { status: 'not-configured' } | { status: 'failed'; reason: string };

/**
 * Send one message over SMTP.
 *
 * Never throws — delivery is best-effort by design. Every caller has a
 * fallback (the invite route still returns `acceptUrl` for manual sharing),
 * so a dead mail server must not turn a successful write into a 500.
 *
 * Logs the recipient address, which is personal data, at `warn`/`error` only.
 * That is the minimum needed to diagnose a bounce; do not add subject or body.
 */
export async function sendMail(mail: Mail, log: ILogger = getLogger()): Promise<SendResult> {
	let config;
	try {
		config = readSmtpConfig();
	} catch (err) {
		log.error('SMTP is misconfigured', {
			component: 'Mailer',
			error: err instanceof Error ? err.message : String(err)
		});
		return { status: 'failed', reason: 'misconfigured' };
	}
	if (!config) return { status: 'not-configured' };

	try {
		// Lazy: an instance with no SMTP_HOST never pays to load nodemailer.
		const { createTransport } = await import('nodemailer');
		const transport = createTransport({
			host: config.host,
			port: config.port,
			secure: config.secure,
			auth: config.auth
		});

		await transport.sendMail({
			from: config.from,
			to: mail.to,
			subject: mail.subject,
			text: mail.text,
			html: mail.html
		});
		return { status: 'sent' };
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		log.warn('Failed to send mail', { component: 'Mailer', to: mail.to, reason });
		return { status: 'failed', reason };
	}
}

/** Whether this instance can send mail at all — drives UI copy. */
export function isMailConfigured(): boolean {
	try {
		return readSmtpConfig() !== null;
	} catch {
		return false;
	}
}
