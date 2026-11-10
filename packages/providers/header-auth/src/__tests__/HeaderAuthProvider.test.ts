import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AuthUser } from '@selvajs/platform';
import { runAuthCoreConformance } from '@selvajs/platform/testing';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { HeaderAuthProvider } from '../HeaderAuthProvider.js';

const DEFAULT_HEADERS = {
	upn: 'SELVA-UserPrincipalName',
	email: 'SELVA-Email',
	displayName: 'SELVA-DisplayName'
};

let tempDir: string;
let allowlistFilePath: string;
let provider: HeaderAuthProvider;

function makeRequestHeaders(values: Record<string, string | undefined>): Headers {
	const h = new Headers();
	for (const [k, v] of Object.entries(values)) {
		if (v !== undefined) h.set(k, v);
	}
	return h;
}

beforeEach(async () => {
	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-header-auth-test-'));
	allowlistFilePath = path.join(tempDir, 'header-allowlist.json');
	provider = new HeaderAuthProvider({ allowlistFilePath });
});

afterEach(async () => {
	await fs.rm(tempDir, { recursive: true, force: true });
});

runAuthCoreConformance({
	name: 'HeaderAuthProvider',
	createProvider: () => ({
		provider: new HeaderAuthProvider({ allowlistFilePath }),
		adminPassword: ''
	})
});

// ============================================================================
// IAuthProvider surface — non-IdP methods
// ============================================================================

describe('HeaderAuthProvider — IAuthProvider surface', () => {
	it('verifyToken always returns null — identity rides on headers', async () => {
		expect(await provider.verifyToken('anything')).toBeNull();
		expect(await provider.verifyToken('')).toBeNull();
	});

	it('createUser + getUser round-trips and returns an AuthUser shape', async () => {
		const created = await provider.createUser('Alice@Example.COM');
		expect(created.id).toBeTruthy();
		// The stored email column starts empty until first proxy visit, but the
		// AuthUser view falls back to the UPN so user lists never show bare UUIDs.
		expect(created.email).toBe('alice@example.com');
		// UPN/displayName live in metadata (AuthUser is identity-only).
		expect(created.metadata?.upn).toBe('alice@example.com');

		const fetched = await provider.getUser(created.id);
		expect(fetched?.id).toBe(created.id);
		expect(fetched?.metadata?.upn).toBe('alice@example.com');
	});

	it('materialized email replaces the UPN fallback after first login', async () => {
		const created = await provider.createUser('alice@tenant.onmicrosoft.com');
		expect(created.email).toBe('alice@tenant.onmicrosoft.com');

		await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({
				[DEFAULT_HEADERS.upn]: 'alice@tenant.onmicrosoft.com',
				[DEFAULT_HEADERS.email]: 'alice@company.com'
			})
		);

		const fetched = await provider.getUser(created.id);
		expect(fetched?.email).toBe('alice@company.com');
	});

	it('listUsers paginates with limit + cursor', async () => {
		await provider.createUser('a@example.com');
		await provider.createUser('b@example.com');
		await provider.createUser('c@example.com');

		const first = await provider.listUsers({ limit: 2 });
		expect(first?.items).toHaveLength(2);
		expect(first?.nextCursor).toBeDefined();

		const next = await provider.listUsers({ limit: 2, cursor: first!.nextCursor });
		expect(next?.items).toHaveLength(1);
		expect(next?.nextCursor).toBeUndefined();
	});

	it('disableUser flags the row and identifyFromHeaders subsequently refuses it', async () => {
		const created = await provider.createUser('alice@example.com');
		expect(await provider.disableUser(created.id)).toBe('ok');

		const user = await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({ [DEFAULT_HEADERS.upn]: 'alice@example.com' })
		);
		expect(user).toBeNull();
	});
});

// ============================================================================
// identifyFromHeaders — the load-bearing security path
// ============================================================================

describe('HeaderAuthProvider — identifyFromHeaders', () => {
	it('returns null when the UPN header is absent (anonymous case)', async () => {
		const result = await provider.proxyAuth.identifyFromHeaders(new Headers());
		expect(result).toBeNull();
	});

	it('returns null when the UPN header is blank/whitespace', async () => {
		const result = await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({ [DEFAULT_HEADERS.upn]: '   ' })
		);
		expect(result).toBeNull();
	});

	it('returns null when the UPN is not in the allowlist', async () => {
		const result = await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({ [DEFAULT_HEADERS.upn]: 'attacker@example.com' })
		);
		expect(result).toBeNull();
	});

	it('matches an allowlisted UPN case-insensitively', async () => {
		await provider.createUser('alice@example.com');
		const result = await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({ [DEFAULT_HEADERS.upn]: 'ALICE@Example.COM' })
		);
		expect(result?.metadata?.upn).toBe('alice@example.com');
	});

	it('reads custom header names when configured', async () => {
		const custom = new HeaderAuthProvider({
			allowlistFilePath,
			headers: {
				upn: 'X-Auth-Request-User',
				email: 'X-Auth-Request-Email',
				displayName: 'X-Auth-Request-Preferred-Username'
			}
		});
		await custom.createUser('alice@example.com');

		// The default header name should now do NOTHING.
		const fromDefault = await custom.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({ [DEFAULT_HEADERS.upn]: 'alice@example.com' })
		);
		expect(fromDefault).toBeNull();

		// The configured header should work.
		const fromCustom = await custom.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({ 'X-Auth-Request-User': 'alice@example.com' })
		);
		expect(fromCustom?.metadata?.upn).toBe('alice@example.com');
	});

	it('materializes email and displayName from headers on first sight', async () => {
		const created = await provider.createUser('alice@example.com');
		const result = await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({
				[DEFAULT_HEADERS.upn]: 'alice@example.com',
				[DEFAULT_HEADERS.email]: 'alice@example.com',
				[DEFAULT_HEADERS.displayName]: 'Alice Anderson'
			})
		);
		expect(result?.email).toBe('alice@example.com');
		expect(result?.metadata?.displayName).toBe('Alice Anderson');

		// Re-read through getUser to confirm it persisted.
		const refetched = await provider.getUser(created.id);
		expect(refetched?.email).toBe('alice@example.com');
	});

	it('updates a stale display name on the next visit after the proxy is corrected', async () => {
		const created = await provider.createUser('alice@example.com');
		// A misconfigured proxy forwarded the OIDC `sub` claim as the display name.
		await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({
				[DEFAULT_HEADERS.upn]: 'alice@example.com',
				[DEFAULT_HEADERS.displayName]: 'Ej__G0eDRH1ab4_YZwLd20HrAOHeMAEk14xhmBW5Zfk'
			})
		);
		// Proxy fixed — the very next visit heals the stored row.
		const result = await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({
				[DEFAULT_HEADERS.upn]: 'alice@example.com',
				[DEFAULT_HEADERS.displayName]: 'Alice Anderson'
			})
		);
		expect(result?.metadata?.displayName).toBe('Alice Anderson');
		const refetched = await provider.getUser(created.id);
		expect(refetched?.metadata?.displayName).toBe('Alice Anderson');
	});

	it('resolves a row pre-allowlisted by email when the proxy UPN differs', async () => {
		// Entra norm: admin allowlists by mail, proxy forwards a different UPN.
		const created = await provider.createUser('alice@company.com');
		const headers = {
			[DEFAULT_HEADERS.upn]: 'alice@tenant.onmicrosoft.com',
			[DEFAULT_HEADERS.email]: 'alice@company.com'
		};
		const result = await provider.proxyAuth.identifyFromHeaders(makeRequestHeaders(headers));
		expect(result?.id).toBe(created.id);

		// Every subsequent login takes the same email-fallback branch — the row
		// is resolved, not rewritten.
		const second = await provider.proxyAuth.identifyFromHeaders(makeRequestHeaders(headers));
		expect(second?.id).toBe(created.id);
	});

	it('binds an email-fallback row to the first UPN that signs in to it', async () => {
		const created = await provider.createUser('alice@company.com');
		const alice = {
			[DEFAULT_HEADERS.upn]: 'alice@tenant.onmicrosoft.com',
			[DEFAULT_HEADERS.email]: 'alice@company.com'
		};
		expect((await provider.proxyAuth.identifyFromHeaders(makeRequestHeaders(alice)))?.id).toBe(
			created.id
		);

		const spoofed = await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({
				[DEFAULT_HEADERS.upn]: 'attacker@evil.example',
				[DEFAULT_HEADERS.email]: 'alice@company.com'
			})
		);
		expect(spoofed).toBeNull();

		// The lookup key is untouched, and Alice still gets in.
		expect((await provider.getUser(created.id))?.metadata?.upn).toBe('alice@company.com');
		expect((await provider.proxyAuth.identifyFromHeaders(makeRequestHeaders(alice)))?.id).toBe(
			created.id
		);
	});

	it("refuses an unlisted UPN that presents a signed-in user's email", async () => {
		// Most rows' UPN is an address, so without the claim any of them, admins
		// included, would open to an email header the proxy failed to strip.
		const warn = vi.fn();
		const p = new HeaderAuthProvider({
			allowlistFilePath,
			logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() } as never
		});
		const admin = await p.createUser('admin@corp.example');
		await p.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({ [DEFAULT_HEADERS.upn]: 'admin@corp.example' })
		);

		const intern = await p.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({
				[DEFAULT_HEADERS.upn]: 'intern@corp.example',
				[DEFAULT_HEADERS.email]: 'admin@corp.example'
			})
		);

		expect(intern).toBeNull();
		expect(warn).toHaveBeenCalledOnce();
		// Identifiers only: the log can't be erased, so no addresses in it.
		expect(warn.mock.calls[0][1]).toEqual({ component: 'HeaderAuth', userId: admin.id });
	});

	it('logs every refused claim, each with the user it refused', async () => {
		const warn = vi.fn();
		const p = new HeaderAuthProvider({
			allowlistFilePath,
			logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() } as never
		});
		const admin = await p.createUser('admin@corp.example');
		const bob = await p.createUser('bob@corp.example');
		for (const upn of ['admin@corp.example', 'bob@corp.example']) {
			await p.proxyAuth.identifyFromHeaders(makeRequestHeaders({ [DEFAULT_HEADERS.upn]: upn }));
		}

		for (const target of ['admin@corp.example', 'bob@corp.example', 'admin@corp.example']) {
			await p.proxyAuth.identifyFromHeaders(
				makeRequestHeaders({
					[DEFAULT_HEADERS.upn]: 'intern@corp.example',
					[DEFAULT_HEADERS.email]: target
				})
			);
		}

		expect(warn.mock.calls.map(([, meta]) => meta.userId)).toEqual([admin.id, bob.id, admin.id]);
	});

	it('lets a direct UPN match take the claim over, as after a UPN cleanup', async () => {
		// Allowlisted by mail; first sign-in on the onmicrosoft UPN claims it.
		const created = await provider.createUser('alice@company.com');
		const before = {
			[DEFAULT_HEADERS.upn]: 'alice@tenant.onmicrosoft.com',
			[DEFAULT_HEADERS.email]: 'alice@company.com'
		};
		expect((await provider.proxyAuth.identifyFromHeaders(makeRequestHeaders(before)))?.id).toBe(
			created.id
		);

		// The tenant moves her UPN onto the company domain: it now matches the row itself.
		const after = await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({
				[DEFAULT_HEADERS.upn]: 'alice@company.com',
				[DEFAULT_HEADERS.email]: 'alice@company.com'
			})
		);
		expect(after?.id).toBe(created.id);

		// The claim moved, so the old UPN no longer gets in through the email.
		expect(await provider.proxyAuth.identifyFromHeaders(makeRequestHeaders(before))).toBeNull();
	});

	it("evicts a spoofed claim once the row's real owner signs in", async () => {
		const created = await provider.createUser('alice@company.com');
		const spoofed = {
			[DEFAULT_HEADERS.upn]: 'attacker@evil.example',
			[DEFAULT_HEADERS.email]: 'alice@company.com'
		};
		await provider.proxyAuth.identifyFromHeaders(makeRequestHeaders(spoofed));

		const alice = await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({ [DEFAULT_HEADERS.upn]: 'alice@company.com' })
		);

		expect(alice?.id).toBe(created.id);
		expect(await provider.proxyAuth.identifyFromHeaders(makeRequestHeaders(spoofed))).toBeNull();
	});

	it('needs only the new upn on the row after a UPN rename', async () => {
		const created = await provider.createUser('alice@corp.example');
		await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({ [DEFAULT_HEADERS.upn]: 'alice@corp.example' })
		);
		const file = JSON.parse(await fs.readFile(allowlistFilePath, 'utf-8'));
		file.users[0].upn = 'alice.smith@corp.example';
		await fs.writeFile(allowlistFilePath, JSON.stringify(file));

		const renamed = await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({ [DEFAULT_HEADERS.upn]: 'Alice.Smith@corp.example' })
		);

		expect(renamed?.id).toBe(created.id);
	});

	it('claims a row from before claims existed on its next sign-in', async () => {
		await fs.writeFile(
			allowlistFilePath,
			JSON.stringify({
				users: [
					{
						id: 'legacy-row',
						upn: 'alice@company.com',
						createdAt: '2026-01-01T00:00:00.000Z',
						lastLoginAt: '2026-06-01T00:00:00.000Z'
					}
				]
			})
		);
		const alice = {
			[DEFAULT_HEADERS.upn]: 'alice@tenant.onmicrosoft.com',
			[DEFAULT_HEADERS.email]: 'alice@company.com'
		};

		expect((await provider.proxyAuth.identifyFromHeaders(makeRequestHeaders(alice)))?.id).toBe(
			'legacy-row'
		);
		const stored = JSON.parse(await fs.readFile(allowlistFilePath, 'utf-8'));
		expect(stored.users[0].claimedByUpn).toBe('alice@tenant.onmicrosoft.com');
	});

	it('refuses to identify a disabled user even with valid headers', async () => {
		const created = await provider.createUser('alice@example.com');
		await provider.disableUser(created.id);
		const result = await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({ [DEFAULT_HEADERS.upn]: 'alice@example.com' })
		);
		expect(result).toBeNull();
	});

	// The refusal itself is not what these assert: a comma-joined UPN matches no
	// allowlist row, so it already failed before this check existed. The check
	// earns its place by naming the cause — without the warning, a non-stripping
	// proxy is indistinguishable from "user not allowlisted".
	it('names the non-stripping proxy when a UPN header carries two values', async () => {
		const warn = vi.fn();
		const p = new HeaderAuthProvider({
			allowlistFilePath,
			logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() } as never
		});
		await p.createUser('alice@company.com');

		const h = new Headers();
		h.append(DEFAULT_HEADERS.upn, 'attacker@evil.example');
		h.append(DEFAULT_HEADERS.upn, 'alice@company.com');

		expect(await p.proxyAuth.identifyFromHeaders(h)).toBeNull();
		expect(warn).toHaveBeenCalledOnce();
		expect(warn.mock.calls[0][0]).toMatch(/not stripping/i);
		expect(warn.mock.calls[0][1]).toMatchObject({ header: DEFAULT_HEADERS.upn });
	});

	it('refuses the joined UPN even when the spoofed half is the allowlisted one', async () => {
		await provider.createUser('alice@company.com');
		const h = new Headers();
		h.append(DEFAULT_HEADERS.upn, 'alice@company.com');
		h.append(DEFAULT_HEADERS.upn, 'attacker@evil.example');

		expect(await provider.proxyAuth.identifyFromHeaders(h)).toBeNull();
	});

	it('warns once per process, not once per spoofed request', async () => {
		const warn = vi.fn();
		const p = new HeaderAuthProvider({
			allowlistFilePath,
			logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() } as never
		});
		const h = new Headers();
		h.append(DEFAULT_HEADERS.upn, 'a@x.example');
		h.append(DEFAULT_HEADERS.upn, 'b@y.example');

		await p.proxyAuth.identifyFromHeaders(h);
		await p.proxyAuth.identifyFromHeaders(h);
		expect(warn).toHaveBeenCalledOnce();
	});

	it('does not reject a display name containing a comma', async () => {
		// "Doe, Jane" is standard Entra formatting — gating the display-name
		// header on commas would break working deployments.
		const created = await provider.createUser('alice@company.com');
		const result = await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({
				[DEFAULT_HEADERS.upn]: 'alice@company.com',
				[DEFAULT_HEADERS.displayName]: 'Anderson, Alice'
			})
		);
		expect(result?.id).toBe(created.id);
		expect(result?.metadata?.displayName).toBe('Anderson, Alice');
	});

	it('ignores a duplicated email header, so a matching UPN still identifies', async () => {
		const created = await provider.createUser('alice@company.com');
		const h = new Headers();
		h.append(DEFAULT_HEADERS.upn, 'alice@company.com');
		h.append(DEFAULT_HEADERS.email, 'alice@company.com');
		h.append(DEFAULT_HEADERS.email, 'spoof@evil.example');

		expect((await provider.proxyAuth.identifyFromHeaders(h))?.id).toBe(created.id);
		expect((await provider.getUser(created.id))?.email).not.toContain('spoof');
	});

	it('names the non-stripping proxy when the email header carries two values', async () => {
		const warn = vi.fn();
		const p = new HeaderAuthProvider({
			allowlistFilePath,
			logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() } as never
		});
		const h = new Headers();
		h.append(DEFAULT_HEADERS.upn, 'attacker@evil.example');
		h.append(DEFAULT_HEADERS.email, 'alice@company.com');
		h.append(DEFAULT_HEADERS.email, 'attacker@evil.example');

		await p.proxyAuth.identifyFromHeaders(h);
		await p.proxyAuth.identifyFromHeaders(h);
		expect(warn).toHaveBeenCalledOnce();
		expect(warn.mock.calls[0][1]).toMatchObject({ header: DEFAULT_HEADERS.email });
	});

	it('does NOT auto-create rows when no bootstrap policy is configured', async () => {
		// This is the security invariant: the allowlist IS the boundary.
		const result = await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({ [DEFAULT_HEADERS.upn]: 'attacker@example.com' })
		);
		expect(result).toBeNull();

		// File should still be empty / non-existent.
		const all = await provider.listUsers();
		expect(all?.items).toEqual([]);
	});

	// Root and Windows ignore directory permissions, so the write would succeed and prove nothing.
	it.skipIf(process.getuid?.() === 0 || process.platform === 'win32')(
		'still signs in an unclaimed user when the allowlist cannot be written',
		async () => {
			const alice = await provider.createUser('alice@company.com');
			await fs.chmod(tempDir, 0o555);
			try {
				const byUpn = await provider.proxyAuth.identifyFromHeaders(
					makeRequestHeaders({ [DEFAULT_HEADERS.upn]: 'alice@company.com' })
				);
				expect(byUpn?.id).toBe(alice.id);

				const byEmail = await provider.proxyAuth.identifyFromHeaders(
					makeRequestHeaders({
						[DEFAULT_HEADERS.upn]: 'alice@tenant.onmicrosoft.com',
						[DEFAULT_HEADERS.email]: 'alice@company.com'
					})
				);
				expect(byEmail?.id).toBe(alice.id);
			} finally {
				await fs.chmod(tempDir, 0o755);
			}
		}
	);
});

// ============================================================================
// Bootstrap-allowlist policy — first-admin auto-allowlist
// ============================================================================

describe('HeaderAuthProvider — sign-in contract', () => {
	it('a proxied visit is a sign-in: it stamps lastLoginAt', async () => {
		const created = await provider.createUser!('alice@example.com');
		expect((await provider.getUser(created.id))?.lastLoginAt).toBeUndefined();
		await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({ 'SELVA-UserPrincipalName': 'alice@example.com' })
		);
		const stamped = (await provider.getUser(created.id))?.lastLoginAt;
		expect(Number.isFinite(Date.parse(stamped ?? ''))).toBe(true);
	});
});

describe('HeaderAuthProvider — bootstrap policy', () => {
	it('auto-allowlists when policy returns true and grants identity in the same call', async () => {
		const policy = vi.fn(async () => true);
		provider.setBootstrapAllowlistPolicy(policy);

		const result = await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({
				[DEFAULT_HEADERS.upn]: 'first-admin@example.com',
				[DEFAULT_HEADERS.email]: 'first-admin@example.com',
				[DEFAULT_HEADERS.displayName]: 'First Admin'
			})
		);
		expect(result?.metadata?.upn).toBe('first-admin@example.com');
		expect(result?.email).toBe('first-admin@example.com');
		expect(policy).toHaveBeenCalledWith({
			upn: 'first-admin@example.com',
			email: 'first-admin@example.com'
		});

		const all = await provider.listUsers();
		expect(all?.items).toHaveLength(1);
	});

	it('does NOT auto-allowlist when policy returns false', async () => {
		provider.setBootstrapAllowlistPolicy(async () => false);

		const result = await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({
				[DEFAULT_HEADERS.upn]: 'wrong-user@example.com',
				[DEFAULT_HEADERS.email]: 'wrong-user@example.com'
			})
		);
		expect(result).toBeNull();

		const all = await provider.listUsers();
		expect(all?.items).toEqual([]);
	});

	it('does not consult the policy when the user is already allowlisted', async () => {
		await provider.createUser('alice@example.com');
		const policy = vi.fn(async () => true);
		provider.setBootstrapAllowlistPolicy(policy);

		const result = await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({ [DEFAULT_HEADERS.upn]: 'alice@example.com' })
		);
		expect(result).toBeTruthy();
		expect(policy).not.toHaveBeenCalled();
	});

	it('clears via setBootstrapAllowlistPolicy(null)', async () => {
		provider.setBootstrapAllowlistPolicy(async () => true);
		// Sanity: policy is active.
		const grant1 = await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({ [DEFAULT_HEADERS.upn]: 'one@example.com' })
		);
		expect(grant1).toBeTruthy();

		provider.setBootstrapAllowlistPolicy(null);

		const grant2 = await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({ [DEFAULT_HEADERS.upn]: 'two@example.com' })
		);
		expect(grant2).toBeNull();
	});

	it('handles a concurrent-race where another caller created the row first', async () => {
		// The policy runs between the lookup miss and the bootstrap create, so a
		// policy that creates the row stands in for the request that got there first:
		// the create then meets a 409 and has to re-read.
		let raced: AuthUser | undefined;
		provider.setBootstrapAllowlistPolicy(async ({ upn }) => {
			raced = await provider.createUser(upn);
			return true;
		});

		const result = await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({ [DEFAULT_HEADERS.upn]: 'first-admin@example.com' })
		);
		expect(raced).toBeDefined();
		expect(result?.id).toBe(raced?.id);
		expect((await provider.listUsers())?.items).toHaveLength(1);
	});
});

// ============================================================================
// fromEnv — env-driven construction
// ============================================================================

describe('HeaderAuthProvider.fromEnv', () => {
	it('falls back to DATA_PATH when HEADER_AUTH_DATA_DIR is unset', async () => {
		const p = HeaderAuthProvider.fromEnv({ DATA_PATH: tempDir });
		await p.createUser('alice@example.com');
		const onDisk = JSON.parse(
			await fs.readFile(path.join(tempDir, 'header-allowlist.json'), 'utf-8')
		);
		expect(onDisk.users).toHaveLength(1);
	});

	it('throws when neither HEADER_AUTH_DATA_DIR nor DATA_PATH is set', () => {
		expect(() => HeaderAuthProvider.fromEnv({})).toThrow(/HEADER_AUTH_DATA_DIR/);
	});

	it('honors HEADER_AUTH_*_HEADER overrides', async () => {
		const p = HeaderAuthProvider.fromEnv({
			HEADER_AUTH_DATA_DIR: tempDir,
			HEADER_AUTH_UPN_HEADER: 'X-Auth-Request-User',
			HEADER_AUTH_EMAIL_HEADER: 'X-Auth-Request-Email',
			HEADER_AUTH_DISPLAY_NAME_HEADER: 'X-Auth-Request-Preferred-Username'
		});
		await p.createUser('alice@example.com');

		// Default header name must NOT work.
		expect(
			await p.proxyAuth.identifyFromHeaders(
				makeRequestHeaders({ [DEFAULT_HEADERS.upn]: 'alice@example.com' })
			)
		).toBeNull();

		// Configured header MUST work.
		const result = await p.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({ 'X-Auth-Request-User': 'alice@example.com' })
		);
		expect(result?.metadata?.upn).toBe('alice@example.com');
	});
});

// ============================================================================
// End-to-end deployment-shape walkthrough
// ============================================================================
//
// Models the lifecycle of a fresh single-tenant deployment running behind a
// trusted proxy: nothing exists → operator turns on a bootstrap policy → first
// proxy-authed visitor lands as admin → policy is revoked → a second
// unrecognized user is correctly rejected → admin allowlists them by hand →
// they land successfully on their next visit. This is the "does it actually
// work end-to-end" smoke test for the package.
// ============================================================================

describe('HeaderAuthProvider — end-to-end deployment walkthrough', () => {
	it('runs the fresh-install → first-admin → second-user happy path', async () => {
		const provider = HeaderAuthProvider.fromEnv({ HEADER_AUTH_DATA_DIR: tempDir });

		// 1. Fresh install. Nothing in the allowlist. A would-be admin can't
		//    get in yet — the strict default rejects unrecognized UPNs.
		const blockedFirst = await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({
				[DEFAULT_HEADERS.upn]: 'ceo@company.com',
				[DEFAULT_HEADERS.email]: 'ceo@company.com'
			})
		);
		expect(blockedFirst).toBeNull();

		// 2. Operator sets BOOTSTRAP_INSTANCE_ADMIN_EMAIL and the platform
		//    wires a one-shot policy that says "yes" iff the email matches AND
		//    no admin exists yet. We simulate `hasInstanceAdmin` with a flag.
		let hasInstanceAdmin = false;
		const bootstrapEmail = 'ceo@company.com';
		provider.setBootstrapAllowlistPolicy(async ({ upn, email }) => {
			if (hasInstanceAdmin) return false;
			const candidate = (email ?? upn).trim().toLowerCase();
			return candidate === bootstrapEmail;
		});

		// 3. The matching user visits — gets identified AND auto-allowlisted.
		const ceo = await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({
				[DEFAULT_HEADERS.upn]: 'ceo@company.com',
				[DEFAULT_HEADERS.email]: 'ceo@company.com',
				[DEFAULT_HEADERS.displayName]: 'CEO'
			})
		);
		expect(ceo?.metadata?.upn).toBe('ceo@company.com');
		expect(ceo?.email).toBe('ceo@company.com');

		// 4. The platform layer (simulated) grants instance_admin permissions,
		//    flips the hasInstanceAdmin flag, and the bootstrap window closes.
		hasInstanceAdmin = true;

		// 5. A second unrecognized user still gets rejected — the bootstrap
		//    window does NOT widen the allowlist for everyone.
		const blockedSecond = await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({
				[DEFAULT_HEADERS.upn]: 'random@company.com',
				[DEFAULT_HEADERS.email]: 'random@company.com'
			})
		);
		expect(blockedSecond).toBeNull();

		// 6. CEO allowlists a teammate by hand (admin UI → POST /admin/api/users).
		await provider.createUser('alice@company.com');

		// 7. Alice's first visit succeeds and materializes her profile fields.
		const alice = await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({
				[DEFAULT_HEADERS.upn]: 'alice@company.com',
				[DEFAULT_HEADERS.email]: 'alice@company.com',
				[DEFAULT_HEADERS.displayName]: 'Alice'
			})
		);
		expect(alice?.metadata?.upn).toBe('alice@company.com');
		expect(alice?.email).toBe('alice@company.com');
		expect(alice?.metadata?.displayName).toBe('Alice');

		// 8. Admin lists users — both rows are present, identity-only.
		const page = await provider.listUsers();
		expect(page?.items.map((u) => u.metadata?.upn).sort()).toEqual([
			'alice@company.com',
			'ceo@company.com'
		]);

		// 9. CEO offboards Alice. Her next visit is rejected even though the
		//    proxy is still happily forwarding her headers.
		await provider.disableUser(alice!.id);
		const aliceAfter = await provider.proxyAuth.identifyFromHeaders(
			makeRequestHeaders({ [DEFAULT_HEADERS.upn]: 'alice@company.com' })
		);
		expect(aliceAfter).toBeNull();
	});
});
