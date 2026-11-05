import { createHmac, randomBytes } from 'node:crypto';
import {
	NoopLogger,
	type ILogger,
	type INotificationProvider,
	type OutboundMessage,
	type SendResult
} from '@selvajs/platform';
import { readSmtpConfig, type SmtpEnv } from './smtp-config.js';

// Per process: the hash only has to match up within one run of the logs.
const RECIPIENT_HASH_KEY = randomBytes(32);

function recipientHash(to: string): string {
	return createHmac('sha256', RECIPIENT_HASH_KEY).update(to).digest('hex').slice(0, 16);
}

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
			// Never the raw message: an SMTP rejection quotes the address, and erasure
			// can't reach stdout. The keyed hash still matches up failures to one person.
			const { code, responseCode } = err as { code?: string; responseCode?: number };
			log.warn('Failed to send mail', {
				component: 'SmtpNotificationProvider',
				recipient: recipientHash(message.to),
				kind: message.kind,
				code,
				responseCode
			});
			return { status: 'failed', reason: code ?? 'send-failed' };
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
