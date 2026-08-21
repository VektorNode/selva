export interface SmtpConfig {
	host: string;
	port: number;
	secure: boolean;
	auth?: { user: string; pass: string };
	from: string;
}

/** The env vars this provider reads. The app passes `process.env` or its framework equivalent. */
export interface SmtpEnv {
	SMTP_HOST?: string;
	SMTP_PORT?: string;
	SMTP_USER?: string;
	SMTP_PASS?: string;
	SMTP_FROM?: string;
	SMTP_SECURE?: string;
}

function parsePort(raw: string | undefined): number {
	const n = Number(raw ?? 587);
	return Number.isInteger(n) && n > 0 && n < 65536 ? n : 587;
}

/**
 * Read SMTP settings from an env bag. Taken as a parameter rather than read
 * from `process.env` directly: under `vite dev` the framework does not mirror
 * `.env` into `process.env`, so the app must hand over its own resolved env
 * (`$env/dynamic/private` in SvelteKit) or overrides silently fall back to
 * defaults.
 *
 * Returns null when mail is not configured — the caller treats that as "no
 * mail", not as an error.
 *
 * Throws only when `SMTP_HOST` is set but `SMTP_FROM` is missing: that
 * combination is a half-finished config, and failing loudly beats silently
 * never sending. Every message needs an envelope sender, and guessing one
 * produces mail that fails SPF at the recipient.
 */
export function readSmtpConfig(env: SmtpEnv): SmtpConfig | null {
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
