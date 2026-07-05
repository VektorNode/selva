/**
 * CI-runnable (no live stack) tests for §1b hybrid token verification. Stubs
 * the internal anon client's `getClaims` (local JWT verify) and `getUser`
 * (network GoTrue verify) so we can assert the network-call behavior directly.
 *
 * Contract:
 *  - hybrid (default): verify locally via getClaims on every request; hit
 *    getUser at most once per `revalidateMs` per session; a getUser rejection
 *    during that recheck (sign-out / disabled) denies immediately.
 *  - strict: getUser on every request.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupabaseAuthProvider } from '../SupabaseAuthProvider.js';

const URL = 'https://example.supabase.co';
const ANON = 'anon-key';
const SERVICE = 'service-key';

interface AuthStub {
	getClaims: ReturnType<typeof vi.fn>;
	getUser: ReturnType<typeof vi.fn>;
}

/** Reach into the provider's private anon client and replace its auth surface. */
function stubAnonAuth(provider: SupabaseAuthProvider): AuthStub {
	const stub: AuthStub = { getClaims: vi.fn(), getUser: vi.fn() };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(provider as any).anon.auth.getClaims = stub.getClaims;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(provider as any).anon.auth.getUser = stub.getUser;
	return stub;
}

function okClaims(overrides: Record<string, unknown> = {}) {
	return {
		data: {
			claims: {
				sub: 'user-1',
				session_id: 'sess-1',
				email: 'u@example.com',
				exp: Math.floor(Date.now() / 1000) + 3600,
				...overrides
			},
			header: {},
			signature: new Uint8Array()
		},
		error: null
	};
}

function okUser() {
	return {
		data: { user: { id: 'user-1', email: 'u@example.com', user_metadata: {} } },
		error: null
	};
}

describe('SupabaseAuthProvider — hybrid token verification', () => {
	beforeEach(() => vi.restoreAllMocks());

	it('verifies locally via getClaims and rechecks getUser once per window', async () => {
		const provider = new SupabaseAuthProvider({
			supabaseUrl: URL,
			anonKey: ANON,
			serviceRoleKey: SERVICE,
			revalidateMs: 60_000
		});
		const stub = stubAnonAuth(provider);
		stub.getClaims.mockResolvedValue(okClaims());
		stub.getUser.mockResolvedValue(okUser());

		// First call: local verify + one recheck (never seen this session).
		const a = await provider.verifyToken('tok');
		expect(a?.id).toBe('user-1');
		expect(stub.getClaims).toHaveBeenCalledTimes(1);
		expect(stub.getUser).toHaveBeenCalledTimes(1);

		// Subsequent calls within the window: local only, NO more getUser.
		await provider.verifyToken('tok');
		await provider.verifyToken('tok');
		expect(stub.getClaims).toHaveBeenCalledTimes(3);
		expect(stub.getUser).toHaveBeenCalledTimes(1); // still just the first
	});

	it('denies immediately when the periodic getUser recheck rejects (signed out / revoked)', async () => {
		const provider = new SupabaseAuthProvider({
			supabaseUrl: URL,
			anonKey: ANON,
			serviceRoleKey: SERVICE
		});
		const stub = stubAnonAuth(provider);
		stub.getClaims.mockResolvedValue(okClaims());
		stub.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'signed out' } });

		const result = await provider.verifyToken('tok');
		expect(result).toBeNull();
	});

	it('denies when the claims already mark the user disabled (no getUser needed)', async () => {
		const provider = new SupabaseAuthProvider({
			supabaseUrl: URL,
			anonKey: ANON,
			serviceRoleKey: SERVICE
		});
		const stub = stubAnonAuth(provider);
		stub.getClaims.mockResolvedValue(okClaims({ user_metadata: { disabled: true } }));

		const result = await provider.verifyToken('tok');
		expect(result).toBeNull();
		expect(stub.getUser).not.toHaveBeenCalled();
	});

	it('denies when getClaims fails (bad signature / expired)', async () => {
		const provider = new SupabaseAuthProvider({
			supabaseUrl: URL,
			anonKey: ANON,
			serviceRoleKey: SERVICE
		});
		const stub = stubAnonAuth(provider);
		stub.getClaims.mockResolvedValue({ data: null, error: { message: 'invalid JWT' } });

		expect(await provider.verifyToken('tok')).toBeNull();
		expect(stub.getUser).not.toHaveBeenCalled();
	});

	it('returns null for an empty token without any network call', async () => {
		const provider = new SupabaseAuthProvider({
			supabaseUrl: URL,
			anonKey: ANON,
			serviceRoleKey: SERVICE
		});
		const stub = stubAnonAuth(provider);
		expect(await provider.verifyToken('')).toBeNull();
		expect(stub.getClaims).not.toHaveBeenCalled();
		expect(stub.getUser).not.toHaveBeenCalled();
	});
});

describe('SupabaseAuthProvider — strict token verification', () => {
	beforeEach(() => vi.restoreAllMocks());

	it('calls getUser on every request and never getClaims', async () => {
		const provider = new SupabaseAuthProvider({
			supabaseUrl: URL,
			anonKey: ANON,
			serviceRoleKey: SERVICE,
			tokenVerification: 'strict'
		});
		const stub = stubAnonAuth(provider);
		stub.getUser.mockResolvedValue(okUser());

		await provider.verifyToken('tok');
		await provider.verifyToken('tok');
		expect(stub.getUser).toHaveBeenCalledTimes(2);
		expect(stub.getClaims).not.toHaveBeenCalled();
	});
});
