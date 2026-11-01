/**
 * Adapter conformance suite for IOAuthAuth and ISessionRefresh.
 *
 * Covers what can be checked in process: provider listing and the refusal of bad
 * credentials. A real code exchange needs a browser at the IdP.
 */

import { describe, it, expect } from 'vitest';
import type { IOAuthAuth, ISessionRefresh } from '../../auth/index.js';

export interface OAuthAuthConformanceOptions {
	name: string;
	createAdapter: () =>
		| Promise<{ oauth: IOAuthAuth; sessionRefresh: ISessionRefresh }>
		| { oauth: IOAuthAuth; sessionRefresh: ISessionRefresh };
}

export function runOAuthAuthConformance(opts: OAuthAuthConformanceOptions): void {
	const { name, createAdapter } = opts;

	describe(`IOAuthAuth conformance: ${name}`, () => {
		it('listProviders names providers in lowercase', async () => {
			const { oauth } = await createAdapter();
			for (const provider of oauth.listProviders()) {
				expect(provider).toBe(provider.toLowerCase());
			}
		});

		it('exchangeOAuthCode returns null for a code nobody issued', async () => {
			const { oauth } = await createAdapter();
			expect(await oauth.exchangeOAuthCode('not-a-real-code')).toBeNull();
		});

		it('refreshSession returns null for a token nobody issued', async () => {
			const { sessionRefresh } = await createAdapter();
			expect(await sessionRefresh.refreshSession('not-a-real-token')).toBeNull();
		});
	});
}
