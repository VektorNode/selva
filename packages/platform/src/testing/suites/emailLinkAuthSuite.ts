/**
 * Adapter conformance suite for IEmailLinkAuth.
 *
 * Tests the contract surface — input validation, error mapping, and rejection
 * of obviously invalid tokens. The full round-trip (real email click) can't
 * be exercised here without intercepting the IdP's mail delivery, so we test
 * what's verifiable in-process and trust the IdP's own integration tests
 * for token correctness.
 *
 * Adapters that don't broker email links should NOT run this suite.
 */

import { describe, it, expect } from 'vitest';
import type { IEmailLinkAuth } from '../../auth/index.js';

export interface EmailLinkAuthConformanceOptions {
	/** Name to show in test output (e.g. "SupabaseEmailLinkAuth"). */
	name: string;
	/**
	 * Factory returning a fresh `IEmailLinkAuth` instance. May be configured
	 * with self-signup enabled or disabled — the suite's tests are robust to
	 * either, since they don't assume new users get created.
	 *
	 * `invalidEmail` is an address the adapter must reject as malformed. A valid
	 * send isn't tested here: it needs real mail delivery.
	 */
	createAdapter: () => Promise<{
		adapter: IEmailLinkAuth;
		invalidEmail: string;
	}>;
}

export function runEmailLinkAuthConformance(opts: EmailLinkAuthConformanceOptions): void {
	const { name, createAdapter } = opts;

	describe(`IEmailLinkAuth conformance: ${name}`, () => {
		it('verifyMagicLink returns null for an empty string', async () => {
			const { adapter } = await createAdapter();
			expect(await adapter.verifyMagicLink('')).toBeNull();
		});

		it.each([
			['without a token', 'https://example.com/callback'],
			[
				'with a garbage token_hash',
				'https://example.com/auth/email/callback?token_hash=NOT-A-REAL-TOKEN&type=magiclink'
			],
			[
				'with an unrecognized verification type',
				'https://example.com/auth/email/callback?token_hash=abc&type=not-a-valid-type'
			]
		])('verifyMagicLink returns null for a URL %s', async (_label, url) => {
			const { adapter } = await createAdapter();
			expect(await adapter.verifyMagicLink(url)).toBeNull();
		});

		it('sendMagicLink rejects obviously invalid emails as { ok: false }', async () => {
			const { adapter, invalidEmail } = await createAdapter();
			const result = await adapter.sendMagicLink(
				invalidEmail,
				'https://example.com/auth/email/callback'
			);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.reason).toBe('invalid_email');
			}
		});
	});
}
