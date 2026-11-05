import { describe, it, expect, vi } from 'vitest';
import type { AuthUser } from '@selvajs/platform';
import { createSessionResolver, type SessionResolverConfig } from '../session-resolver.js';

/** An unsigned JWT: the resolver reads only `sub` and `exp`, and never trusts them. */
function jwt(sub: string, expInSeconds = 3600, at = Date.now()): string {
	const payload = { sub, exp: Math.floor(at / 1000) + expInSeconds, n: Math.random() };
	return ['{}', JSON.stringify(payload), 'sig']
		.map((part, i) => (i < 2 ? Buffer.from(part).toString('base64url') : part))
		.join('.');
}

function subjectOf(token: string): string {
	return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
}

function setup(over: Partial<SessionResolverConfig<string, { user: string; rows: string }>> = {}) {
	const clock = { at: Date.now() };
	const verify = vi.fn(async (token: string): Promise<AuthUser | null> => ({
		id: subjectOf(token)
	}));
	const read = vi.fn(async (userId: string) => `rows-of-${userId}`);
	const resolver = createSessionResolver({
		verify,
		read,
		build: (user, rows) => ({ user: user.id, rows }),
		now: () => clock.at,
		...over
	});
	return { resolver, verify, read, clock };
}

describe('createSessionResolver', () => {
	it('reads the rows beside verify, keyed by the token’s subject', async () => {
		let verified: (u: AuthUser | null) => void = () => {};
		const { resolver, verify, read } = setup();
		verify.mockReturnValueOnce(new Promise((resolve) => (verified = resolve)));
		const pending = resolver.resolve(jwt('u1'));
		await Promise.resolve();
		expect(read).toHaveBeenCalledWith('u1');
		verified({ id: 'u1' });
		expect(await pending).toEqual({ user: 'u1', rows: 'rows-of-u1' });
		expect(read).toHaveBeenCalledTimes(1);
	});

	it('reads again for the user verify names when it is not the token’s claim', async () => {
		const { resolver, verify, read } = setup();
		verify.mockResolvedValueOnce({ id: 'u2' });
		expect(await resolver.resolve(jwt('u1'))).toEqual({ user: 'u2', rows: 'rows-of-u2' });
		expect(read).toHaveBeenLastCalledWith('u2');
	});

	it('answers null, and builds nothing, for a token verify refuses', async () => {
		const build = vi.fn();
		const { resolver, verify } = setup({ build });
		verify.mockResolvedValue(null);
		expect(await resolver.resolve(jwt('u1'))).toBeNull();
		expect(build).not.toHaveBeenCalled();
	});

	it('resolves concurrent requests with one token once', async () => {
		const { resolver, verify } = setup();
		const token = jwt('u1');
		const [a, b] = await Promise.all([resolver.resolve(token), resolver.resolve(token)]);
		expect(a).toBe(b);
		expect(verify).toHaveBeenCalledTimes(1);
	});

	it('keeps nothing between requests without a fresh window', async () => {
		const { resolver, verify } = setup();
		const token = jwt('u1');
		await resolver.resolve(token);
		await resolver.resolve(token);
		expect(verify).toHaveBeenCalledTimes(2);
	});

	describe('with a fresh window', () => {
		it('reuses a session inside the window', async () => {
			const { resolver, verify, clock } = setup({ freshForMs: 60_000 });
			const token = jwt('u1', 3600, clock.at);
			const first = await resolver.resolve(token);
			clock.at += 30_000;
			expect(await resolver.resolve(token)).toBe(first);
			expect(verify).toHaveBeenCalledTimes(1);
		});

		it('answers a session past the window at once and re-checks it behind the request', async () => {
			const { resolver, verify, clock } = setup({ freshForMs: 60_000 });
			const token = jwt('u1', 3600, clock.at);
			const first = await resolver.resolve(token);
			clock.at += 90_000;
			let verified: (u: AuthUser | null) => void = () => {};
			verify.mockReturnValueOnce(new Promise((resolve) => (verified = resolve)));
			expect(await resolver.resolve(token)).toBe(first);
			expect(verify).toHaveBeenCalledTimes(2);
			verified({ id: 'u1' });
			await vi.waitFor(async () => expect(await resolver.resolve(token)).not.toBe(first));
		});

		it('drops a session whose re-check refuses the token', async () => {
			const { resolver, verify, clock } = setup({ freshForMs: 60_000 });
			const token = jwt('u1', 3600, clock.at);
			await resolver.resolve(token);
			clock.at += 90_000;
			verify.mockResolvedValue(null);
			await resolver.resolve(token);
			await vi.waitFor(async () => expect(await resolver.resolve(token)).toBeNull());
		});

		it('keeps the session when a re-check throws, and reports it', async () => {
			const onRefreshError = vi.fn();
			const { resolver, verify, clock } = setup({ freshForMs: 60_000, onRefreshError });
			const token = jwt('u1', 3600, clock.at);
			const first = await resolver.resolve(token);
			clock.at += 90_000;
			verify.mockRejectedValueOnce(new Error('auth server away'));
			await resolver.resolve(token);
			await vi.waitFor(() => expect(onRefreshError).toHaveBeenCalled());
			verify.mockReturnValue(new Promise(() => {}));
			expect(await resolver.resolve(token)).toBe(first);
		});

		it('never answers a session past its token’s expiry', async () => {
			const { resolver, verify, clock } = setup({ freshForMs: 60_000 });
			const token = jwt('u1', 30, clock.at);
			await resolver.resolve(token);
			clock.at += 31_000;
			verify.mockResolvedValue(null);
			expect(await resolver.resolve(token)).toBeNull();
		});

		it('serves nothing stale for a token whose expiry it cannot read', async () => {
			const { resolver, verify, clock } = setup({
				freshForMs: 60_000,
				subjectOf: () => 'u1',
				expiresAtOf: () => null
			});
			verify.mockResolvedValueOnce({ id: 'u1' });
			await resolver.resolve('opaque');
			clock.at += 90_000;
			verify.mockResolvedValue(null);
			expect(await resolver.resolve('opaque')).toBeNull();
		});

		it('forgets a session on invalidate, and a user’s sessions on invalidateUser', async () => {
			const { resolver, verify, clock } = setup({ freshForMs: 60_000 });
			const a = jwt('u1', 3600, clock.at);
			const b = jwt('u1', 3600, clock.at);
			await Promise.all([resolver.resolve(a), resolver.resolve(b)]);
			resolver.invalidate(a);
			await resolver.resolve(a);
			expect(verify).toHaveBeenCalledTimes(3);
			resolver.invalidateUser('u1');
			await Promise.all([resolver.resolve(a), resolver.resolve(b)]);
			expect(verify).toHaveBeenCalledTimes(5);
		});

		it('does not keep a resolution its token was invalidated during', async () => {
			const { resolver, verify, clock } = setup({ freshForMs: 60_000 });
			const token = jwt('u1', 3600, clock.at);
			let verified: (u: AuthUser | null) => void = () => {};
			verify.mockReturnValueOnce(new Promise((resolve) => (verified = resolve)));
			const pending = resolver.resolve(token);
			resolver.invalidate(token);
			verified({ id: 'u1' });
			await pending;
			await resolver.resolve(token);
			expect(verify).toHaveBeenCalledTimes(2);
		});

		it('holds at most maxEntries sessions, dropping the oldest', async () => {
			const { resolver, verify, clock } = setup({ freshForMs: 60_000, maxEntries: 2 });
			const [a, b, c] = ['u1', 'u2', 'u3'].map((u) => jwt(u, 3600, clock.at));
			for (const t of [a, b, c]) await resolver.resolve(t);
			await resolver.resolve(c);
			await resolver.resolve(a);
			expect(verify).toHaveBeenCalledTimes(4);
		});
	});
});
