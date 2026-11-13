import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The secret in the first-run setup link. Derived from `SELVA_HMAC_KEY`, so
 * claiming an instance that has no admin takes read access to its `.env`.
 * Stateless: every instance and the CLI compute the same value.
 */
export function setupToken(hmacKey: string): string {
	return createHmac('sha256', hmacKey.trim()).update('selva:setup:v1').digest('base64url');
}

export function isSetupToken(candidate: string | null | undefined, hmacKey: string): boolean {
	if (!candidate) return false;
	const expected = Buffer.from(setupToken(hmacKey));
	const given = Buffer.from(candidate);
	return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Where the operator claims the instance. `origin` has no trailing slash. */
export function setupUrl(origin: string, hmacKey: string): string {
	return `${origin.replace(/\/+$/, '')}/setup?token=${setupToken(hmacKey)}`;
}
