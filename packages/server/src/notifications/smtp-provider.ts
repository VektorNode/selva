import {
	NoopLogger,
	type ILogger,
	type INotificationProvider,
	type OutboundMessage,
	type SendResult
} from '@selvajs/platform';
import { readSmtpConfig, type SmtpEnv } from './smtp-config.js';

/**
 * SMTP transport. Any server works — a transactional provider, an internal
 * relay, or a mailbox with an app password.
 *
 * Settings are read per send rather than cached, so a restart is the only
 * thing needed to reconfigure and a rotated password takes effect without
 * anyone remembering there is a cache.
 */
export class SmtpNotificationProvider implements INotificationProvider {
	readonly name = 'SMTP';

	constructor(private readonly env: SmtpEnv) {}

	async send(message: OutboundMessage, log: ILogger = new NoopLogger()): Promise<SendResult> {
		let config;
		try {
			config = readSmtpConfig(this.env);
		} catch (err) {
			log.error('SMTP is misconfigured', {
				component: 'SmtpNotificationProvider',
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
				to: message.to,
				subject: message.subject,
				text: message.text,
				html: message.html
			});
			return { status: 'sent' };
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			// Recipient is personal data — logged at warn only, as the minimum
			// needed to diagnose a bounce. Never the subject or body.
			log.warn('Failed to send mail', {
				component: 'SmtpNotificationProvider',
				to: message.to,
				kind: message.kind,
				reason
			});
			return { status: 'failed', reason };
		}
	}

	isConfigured(): boolean {
		try {
			return readSmtpConfig(this.env) !== null;
		} catch {
			return false;
		}
	}
}
