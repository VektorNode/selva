import { env } from '$env/dynamic/private';

/**
 * SMTP settings, read per call so a restart is the only thing needed to
 * reconfigure. Email is optional: with `SMTP_HOST` unset the invite route
 * skips sending and the admin copies the link by hand, exactly as before.
 */
export interface SmtpConfig {
	host: string;
	port: number;
	secure: boolean;
	auth?: { user: string; pass: string };
	from: string;
}

function parsePort(raw: string | undefined): number {
	const n = Number(raw ?? 587);
	return Number.isInteger(n) && n > 0 && n < 65536 ? n : 587;
}

/**
 * Returns null when mail is not configured — the caller treats that as "no
 * mail", not as an error.
 *
 * Throws only when `SMTP_HOST` is set but `SMTP_FROM` is missing: that
 * combination is a half-finished config, and failing loudly beats silently
 * never sending. Every message needs an envelope sender, and guessing one
 * produces mail that fails SPF at the recipient.
 */
export function readSmtpConfig(): SmtpConfig | null {
	const host = env.SMTP_HOST?.trim();
	if (!host) return null;

	const from = env.SMTP_FROM?.trim();
	if (!from) {
		throw new Error('SMTP_HOST is set but SMTP_FROM is missing — mail needs a sender address.');
	}

	const port = parsePort(env.SMTP_PORT);
	const user = env.SMTP_USER?.trim();
	const pass = env.SMTP_PASS;

	return {
		host,
		port,
		// Port 465 is implicit TLS; 587 and 25 start plaintext and upgrade via
		// STARTTLS, which nodemailer does on its own when `secure` is false.
		secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
		auth: user && pass ? { user, pass } : undefined,
		from
	};
}
