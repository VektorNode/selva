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
	 * `validEmail` is an address the adapter will accept (must pass adapter
	 * validation; doesn't need to actually receive mail). `invalidEmail` is
	 * one the adapter must reject as malformed.
	 */
	createAdapter: () => Promise<{
		adapter: IEmailLinkAuth;
		validEmail: string;
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

		it('verifyMagicLink returns null for a URL without a token', async () => {
			const { adapter } = await createAdapter();
			expect(await adapter.verifyMagicLink('https://example.com/callback')).toBeNull();
		});

		it('verifyMagicLink returns null for a URL with garbage token_hash', async () => {
			const { adapter } = await createAdapter();
			const url =
				'https://example.com/auth/email/callback?token_hash=NOT-A-REAL-TOKEN&type=magiclink';
			expect(await adapter.verifyMagicLink(url)).toBeNull();
		});

		it('verifyMagicLink returns null for an unrecognized verification type', async () => {
			const { adapter } = await createAdapter();
			const url = 'https://example.com/auth/email/callback?token_hash=abc&type=not-a-valid-type';
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
				expect(['invalid_email', 'rate_limited']).toContain(result.reason);
			}
		});

		// `sendMagicLink` for a valid email is intentionally NOT tested here:
		// it requires real Supabase project credentials with email delivery
		// enabled, and we'd be asserting on side-effects (mail sent) we can't
		// observe. Adapter-specific integration tests cover that path.
		void '';
	});

	// keep `createAdapter` referenced for adapters that have nothing more to test
	void createAdapter;
}
