import { describe, it, expect } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { issueOAuthState, consumeOAuthState } from '../oauthState.server.js';

function fakeCookies(): Cookies & { store: Map<string, string> } {
	const store = new Map<string, string>();
	return {
		store,
		get: (name: string) => store.get(name),
		set: (name: string, value: string) => void store.set(name, value),
		delete: (name: string) => void store.delete(name)
	} as unknown as Cookies & { store: Map<string, string> };
}

describe('OAuth state nonce', () => {
	it('accepts the nonce it just issued', () => {
		const cookies = fakeCookies();
		const state = issueOAuthState(cookies);
		expect(consumeOAuthState(cookies, state)).toBe(true);
	});

	it('rejects a nonce the attacker made up', () => {
		const cookies = fakeCookies();
		issueOAuthState(cookies);
		expect(consumeOAuthState(cookies, 'attacker-chosen-value')).toBe(false);
	});

	it('rejects a callback that carries no state at all — the login-CSRF shape', () => {
		const cookies = fakeCookies();
		issueOAuthState(cookies);
		expect(consumeOAuthState(cookies, null)).toBe(false);
	});

	it('rejects when no flow was ever started in this browser', () => {
		expect(consumeOAuthState(fakeCookies(), 'anything')).toBe(false);
	});

	it('is single-use — a replay of the same code fails on the second try', () => {
		const cookies = fakeCookies();
		const state = issueOAuthState(cookies);
		expect(consumeOAuthState(cookies, state)).toBe(true);
		expect(consumeOAuthState(cookies, state)).toBe(false);
	});

	it('clears the cookie even on a failed attempt, so a retry cannot reuse it', () => {
		const cookies = fakeCookies();
		const state = issueOAuthState(cookies);
		expect(consumeOAuthState(cookies, 'wrong')).toBe(false);
		expect(consumeOAuthState(cookies, state)).toBe(false);
	});

	it('issues a distinct nonce per flow', () => {
		expect(issueOAuthState(fakeCookies())).not.toBe(issueOAuthState(fakeCookies()));
	});
});
