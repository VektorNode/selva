/**
 * Test fixtures for compute-app integration tests.
 *
 * `freshProviders()` builds a real LocalDataProvider stack rooted in a fresh
 * tmpdir per test — no mocks, no stubs. Tests interact with the same store
 * implementations production uses; only the wiring (provider singleton vs.
 * per-test handle) differs.
 *
 * `setTestProviders()` from ./test-providers makes the stack visible to the
 * mocked `$lib/server/providers.server` so route handlers and access helpers
 * see this test's providers when they call `getProjectProvider()` etc.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import {
	LocalAuthProvider,
	LocalDataProvider,
	LocalStorageProvider,
	createLocalAuthUserStore
} from '@selvajs/local-provider';
import {
	NoopEventSink,
	SYSTEM_CONTEXT,
	DEFAULT_ORG_PERMISSIONS,
	emptyProfile,
	type AuthUser,
	type DefinitionRecord,
	type DefinitionVersion,
	type IOAuthAuth,
	type OrgPermission,
	type Organization,
	type OrgMember,
	type OrgRole,
	type PlatformPermission,
	type Project,
	type ProjectMember,
	type ProjectRole,
	type ProjectVisibility,
	type RequestContext,
	type SelvaConfig,
	type SelvaFlags,
	type ShareLink,
	type TenancyMode
} from '@selvajs/platform';
import {
	DefinitionService,
	type CreateDefinitionRecord
} from '../definitions/DefinitionService.js';
import { hashToken, mintRawToken } from '../shareLinks/token.server.js';
import { setTestProviders, clearTestProviders } from './test-providers.js';

const TEST_HMAC_KEY = 'test-hmac-key-32-chars-min-length';
// Deterministic 32-byte hex — `LocalComputeServerStore.fromEnv` needs a key
// to encrypt the per-server compute config. Tests don't read the encrypted
// blob, but the constructor still requires one.
const TEST_AT_REST_KEY = '0'.repeat(64);

// ============================================================================
// Provider stack
// ============================================================================

export interface TestProviders {
	root: string;
	config: SelvaConfig;
	tenancy: TenancyMode;
	flags: SelvaFlags;
	definitionService: DefinitionService;
	/** Identity-only file (auth-users.json). Shaped like the auth provider's view. */
	authUsers: ReturnType<typeof createLocalAuthUserStore>;
	cleanup: () => Promise<void>;
}

export interface FreshProvidersOpts {
	tenancy?: TenancyMode;
	flags?: SelvaFlags;
}

export async function freshProviders(opts: FreshProvidersOpts = {}): Promise<TestProviders> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-test-'));
	const env = {
		DATA_PATH: root,
		SELVA_HMAC_KEY: TEST_HMAC_KEY,
		SELVA_AT_REST_KEY: TEST_AT_REST_KEY
	};

	const events = new NoopEventSink();
	const auth = LocalAuthProvider.fromEnv(env);
	const data = LocalDataProvider.fromEnv(env, events);
	const storage = LocalStorageProvider.fromEnv(env);
	const authUsers = createLocalAuthUserStore(path.join(root, 'auth-users.json'));

	const config: SelvaConfig = {
		auth,
		data,
		storage,
		events,
		tenancy: opts.tenancy ?? 'single',
		flags: opts.flags ?? {}
	};
	const definitionService = new DefinitionService(data, storage);

	const handle: TestProviders = {
		root,
		config,
		tenancy: config.tenancy ?? 'single',
		flags: config.flags ?? {},
		definitionService,
		authUsers,
		cleanup: async () => {
			clearTestProviders();
			await fs.rm(root, { recursive: true, force: true });
		}
	};

	setTestProviders({
		config: handle.config,
		tenancy: handle.tenancy,
		flags: handle.flags,
		definitionService: handle.definitionService
	});
	return handle;
}

// ============================================================================
// Seeders
// ============================================================================

export interface SeededUser {
	id: string;
	email: string;
}

export async function seedUser(
	tp: TestProviders,
	email: string,
	platformPermissions: PlatformPermission[] = []
): Promise<SeededUser> {
	// Identity row (auth-users.json) + data-layer row (user-data.json), in that
	// order — same sequence production runs through `hooks.server.ts` /
	// `setup`. `null` password marks an OAuth-allowlisted entry; tests don't
	// authenticate, they just need the IDs to align across stores.
	const u = await tp.authUsers.createUser(email, null);
	await tp.config.data.ensureUser(SYSTEM_CONTEXT, u.id);
	if (platformPermissions.length > 0) {
		await tp.config.data.permissions.set(SYSTEM_CONTEXT, u.id, platformPermissions);
	}
	return { id: u.id, email: u.email };
}

export async function seedOrg(
	tp: TestProviders,
	opts: { name: string; slug: string; ownerId: string }
): Promise<Organization> {
	const now = new Date().toISOString();
	const org: Organization = {
		id: randomUUID(),
		name: opts.name,
		slug: opts.slug,
		ownerId: opts.ownerId,
		createdBy: opts.ownerId,
		updatedBy: opts.ownerId,
		createdAt: now,
		updatedAt: now,
		deletedAt: null
	};
	await tp.config.data.orgs.createOrg(SYSTEM_CONTEXT, org);
	return org;
}

export async function seedOrgMember(
	tp: TestProviders,
	opts: { orgId: string; userId: string; role: OrgRole; permissions?: OrgPermission[] }
): Promise<OrgMember> {
	const now = new Date().toISOString();
	const member: OrgMember = {
		orgId: opts.orgId,
		userId: opts.userId,
		role: opts.role,
		permissions: opts.permissions ?? [...DEFAULT_ORG_PERMISSIONS[opts.role]],
		joinedAt: now,
		updatedAt: now,
		updatedBy: opts.userId,
		deletedAt: null
	};
	await tp.config.data.orgs.addOrgMember(SYSTEM_CONTEXT, member);
	return member;
}

export async function seedProject(
	tp: TestProviders,
	opts: {
		orgId: string;
		name: string;
		slug: string;
		ownerId: string;
		visibility?: ProjectVisibility;
		autoJoinOnUpload?: boolean;
	}
): Promise<Project> {
	const now = new Date().toISOString();
	const project: Project = {
		id: randomUUID(),
		orgId: opts.orgId,
		name: opts.name,
		slug: opts.slug,
		visibility: opts.visibility ?? 'private',
		ownerId: opts.ownerId,
		createdBy: opts.ownerId,
		updatedBy: opts.ownerId,
		autoJoinOnUpload: opts.autoJoinOnUpload ?? false,
		createdAt: now,
		updatedAt: now,
		deletedAt: null
	};
	await tp.config.data.projects.createProject(SYSTEM_CONTEXT, project);
	// Owner membership row.
	await tp.config.data.projects.addProjectMember(SYSTEM_CONTEXT, {
		projectId: project.id,
		userId: opts.ownerId,
		role: 'owner',
		joinedAt: now,
		updatedAt: now,
		updatedBy: opts.ownerId,
		deletedAt: null
	});
	return project;
}

export async function seedProjectMember(
	tp: TestProviders,
	opts: { projectId: string; userId: string; role: ProjectRole }
): Promise<ProjectMember> {
	const now = new Date().toISOString();
	const member: ProjectMember = {
		projectId: opts.projectId,
		userId: opts.userId,
		role: opts.role,
		joinedAt: now,
		updatedAt: now,
		updatedBy: opts.userId,
		deletedAt: null
	};
	await tp.config.data.projects.addProjectMember(SYSTEM_CONTEXT, member);
	return member;
}

// ============================================================================
// Definitions + share links
// ============================================================================

export interface SeededDefinition {
	record: DefinitionRecord;
	version: DefinitionVersion;
}

export async function seedDefinition(
	tp: TestProviders,
	opts: {
		projectId: string;
		ownerId: string;
		displayName?: string;
		guid?: string;
	}
): Promise<SeededDefinition> {
	const input: CreateDefinitionRecord = {
		guid: opts.guid ?? randomUUID(),
		projectId: opts.projectId,
		ownerId: opts.ownerId,
		fileExt: 'gh',
		displayName: opts.displayName ?? 'Test Definition',
		originalFilename: 'test.gh'
	};
	const file = new TextEncoder().encode('FAKE_GH_BYTES');
	// Use an admin-shaped ctx so SYSTEM_CONTEXT-style writes aren't rejected.
	const ctx: RequestContext = {
		userId: opts.ownerId,
		actingOrgId: undefined,
		platformPermissions: ['instance_admin'],
		orgPermissions: []
	};
	return tp.definitionService.create(ctx, input, file);
}

export interface SeededShareLink {
	link: ShareLink;
	rawToken: string;
}

export async function seedShareLink(
	tp: TestProviders,
	opts: {
		definitionId: string;
		channel?: 'live' | 'draft';
		createdBy: string;
		allowSolve?: boolean;
		maxSolves?: number | null;
		expiresAt?: string | null;
	}
): Promise<SeededShareLink> {
	const rawToken = mintRawToken();
	const link: ShareLink = {
		id: randomUUID(),
		definitionId: opts.definitionId,
		channel: opts.channel ?? 'live',
		tokenHash: hashToken(rawToken),
		createdBy: opts.createdBy,
		createdAt: new Date().toISOString(),
		expiresAt: opts.expiresAt ?? null,
		revokedAt: null,
		allowSolve: opts.allowSolve ?? true,
		maxSolves: opts.maxSolves === undefined ? 1000 : opts.maxSolves,
		solveCount: 0
	};
	const ctx: RequestContext = {
		userId: opts.createdBy,
		actingOrgId: undefined,
		platformPermissions: ['instance_admin'],
		orgPermissions: []
	};
	await tp.config.data.shareLinks.create(ctx, link);
	return { link, rawToken };
}

export async function grantPlatformPermissions(
	tp: TestProviders,
	userId: string,
	perms: PlatformPermission[]
): Promise<void> {
	await tp.config.data.permissions.set(SYSTEM_CONTEXT, userId, perms);
}

/**
 * Augment the test's auth provider with an `oauth` capability that returns
 * a synthetic session for the given email. The Supabase auth provider
 * exposes `IOAuthAuth` in production; the local one doesn't, so
 * OAuth-callback tests inject this typed shim. `exchangeOAuthCode`
 * creates the auth-users row if missing (matching real Supabase behavior
 * on first sign-in). The data-layer row is auto-seeded by the OAuth
 * callback handler itself via `ensureUser`, exactly as in production.
 */
export function installOAuthShim(
	tp: TestProviders,
	opts: { email: string; userId?: string }
): { calls: number } {
	const state = { calls: 0 };
	void opts.userId; // reserved for future tests that need a deterministic id
	const shim: IOAuthAuth = {
		listProviders: () => [],
		async exchangeOAuthCode(_code: string) {
			state.calls++;
			const existing = await tp.authUsers.findByEmail(opts.email);
			const user = existing ?? (await tp.authUsers.createUser(opts.email, null));
			const finalId = existing ? existing.id : user.id;
			return {
				user: {
					id: finalId,
					email: user.email,
					createdAt: user.createdAt,
					lastLoginAt: user.lastLoginAt,
					disabled: user.disabled
				} as AuthUser,
				sessionToken: 'test-session-' + finalId,
				refreshToken: 'test-refresh-' + finalId
			};
		},
		async getOAuthAuthorizationUrl() {
			throw new Error('OAuth shim: getOAuthAuthorizationUrl not implemented for tests');
		},
		async refreshSession() {
			throw new Error('OAuth shim: refreshSession not implemented for tests');
		}
	};
	// `oauth` on IAuthProvider is `readonly` — we're patching the test
	// provider's identity at runtime, which is exactly the seam the cast was
	// papering over. The shim itself is now fully typed.
	(tp.config.auth as { oauth?: IOAuthAuth }).oauth = shim;
	return state;
}

/**
 * Set an env-stub key visible to code that imports `$env/dynamic/private`.
 * Mutates the shared stub object — restore in afterEach if needed.
 */
export async function setEnv(key: string, value: string | undefined): Promise<void> {
	const mod = await import('./env-stub.js');
	if (value === undefined) delete mod.env[key];
	else mod.env[key] = value;
}

// ============================================================================
// Compound scenario seeders — the §11 cast
// ============================================================================

export interface AcmeFixture {
	acme: Organization;
	alice: SeededUser;
	bob: SeededUser;
	alicesPrivate: Project;
	acmeOrg: Project;
	acmePublic: Project;
}

export async function seedAcme(tp: TestProviders): Promise<AcmeFixture> {
	const alice = await seedUser(tp, 'alice@acme.test');
	const bob = await seedUser(tp, 'bob@acme.test');
	const acme = await seedOrg(tp, { name: 'Acme', slug: 'acme', ownerId: alice.id });
	await seedOrgMember(tp, { orgId: acme.id, userId: alice.id, role: 'admin' });
	await seedOrgMember(tp, { orgId: acme.id, userId: bob.id, role: 'member' });

	const alicesPrivate = await seedProject(tp, {
		orgId: acme.id,
		name: 'Alice Private',
		slug: 'alice-private',
		ownerId: alice.id,
		visibility: 'private'
	});
	const acmeOrg = await seedProject(tp, {
		orgId: acme.id,
		name: 'Acme Org Project',
		slug: 'acme-org',
		ownerId: alice.id,
		visibility: 'org'
	});
	const acmePublic = await seedProject(tp, {
		orgId: acme.id,
		name: 'Acme Public',
		slug: 'acme-public',
		ownerId: alice.id,
		visibility: 'public'
	});

	return { acme, alice, bob, alicesPrivate, acmeOrg, acmePublic };
}

export interface BigClientFixture {
	bigClient: Organization;
	carol: SeededUser;
}

/**
 * Second tenant. Carol is a member of BigClient — used for cross-org rejection
 * scenarios (Carol acting in BigClient context cannot view Acme data).
 */
export async function seedBigClient(tp: TestProviders): Promise<BigClientFixture> {
	const carol = await seedUser(tp, 'carol@bigclient.test');
	const bigClient = await seedOrg(tp, {
		name: 'BigClient',
		slug: 'bigclient',
		ownerId: carol.id
	});
	await seedOrgMember(tp, { orgId: bigClient.id, userId: carol.id, role: 'member' });
	return { bigClient, carol };
}

export interface ThirdOrgFixture {
	initech: Organization;
	dave: SeededUser;
}

/**
 * Third tenant. Dave is a member of Initech — used for cross-org public-visibility
 * scenarios (any authenticated user from any org can view a public project when
 * `ALLOW_CROSS_ORG_PUBLIC=true`).
 */
export async function seedThirdOrg(tp: TestProviders): Promise<ThirdOrgFixture> {
	const dave = await seedUser(tp, 'dave@initech.test');
	const initech = await seedOrg(tp, {
		name: 'Initech',
		slug: 'initech',
		ownerId: dave.id
	});
	await seedOrgMember(tp, { orgId: initech.id, userId: dave.id, role: 'member' });
	return { initech, dave };
}

export interface CommonsFixture {
	commonsProject: Project;
	alicesCommonsDef: SeededDefinition;
	peter: SeededUser;
}

/**
 * Commons-mode project (`autoJoinOnUpload=true`) inside Acme with Alice's
 * pre-existing definition. Peter is a separate authenticated user — *not* a
 * project member — who is allowed to upload his own new definitions but cannot
 * touch Alice's existing one.
 *
 * Requires {@link seedAcme} to have run first (uses Alice as project owner +
 * existing-def owner).
 */
export async function seedCommons(
	tp: TestProviders,
	opts: { acmeId: string; aliceId: string }
): Promise<CommonsFixture> {
	const peter = await seedUser(tp, 'peter@elsewhere.test');
	const commonsProject = await seedProject(tp, {
		orgId: opts.acmeId,
		name: 'Acme Commons',
		slug: 'acme-commons',
		ownerId: opts.aliceId,
		visibility: 'public',
		autoJoinOnUpload: true
	});
	const alicesCommonsDef = await seedDefinition(tp, {
		projectId: commonsProject.id,
		ownerId: opts.aliceId,
		displayName: "Alice's Commons Def"
	});
	return { commonsProject, alicesCommonsDef, peter };
}

// ============================================================================
// Locals + handler invocation
// ============================================================================

/**
 * Build an `App.Locals`-shaped object for the given user. Mirrors
 * `buildContext()` from hooks.server.ts but reads from this test's providers
 * via the mocked module surface.
 */
export async function actAs(
	tp: TestProviders,
	userId: string
): Promise<{
	user: AuthUser;
	ctx: RequestContext;
	profile: ReturnType<typeof emptyProfile>;
	providers: SelvaConfig;
}> {
	const stored = await tp.authUsers.findById(userId);
	if (!stored) throw new Error(`actAs: user not found: ${userId}`);
	const user: AuthUser = {
		id: stored.id,
		email: stored.email,
		createdAt: stored.createdAt,
		lastLoginAt: stored.lastLoginAt,
		disabled: stored.disabled
	};

	const platformPermissions = await tp.config.data.permissions.getFor(SYSTEM_CONTEXT, user.id);
	// Mirror the production bootstrap path (hooks.server.ts) — single
	// `findUserMembership` lookup, with the instance-admin fallback to the
	// first listed org for admins not in any org. Keeping this aligned with
	// production behavior is the whole point of testing routes through real
	// stores instead of mocks.
	const membership = await tp.config.data.orgs.findUserMembership(SYSTEM_CONTEXT, user.id);
	let actingOrgId: string | undefined = membership?.org.id;
	const orgPermissions: OrgPermission[] = membership ? [...membership.member.permissions] : [];
	if (!actingOrgId && platformPermissions.includes('instance_admin')) {
		const firstOrgPage = await tp.config.data.orgs.listOrgs(SYSTEM_CONTEXT, { limit: 1 });
		actingOrgId = firstOrgPage.items[0]?.id;
	}

	const ctx: RequestContext = {
		userId: user.id,
		actingOrgId,
		platformPermissions,
		orgPermissions
	};

	const profile =
		(await tp.config.data.userProfile.getProfile(SYSTEM_CONTEXT, user.id)) ?? emptyProfile(user.id);

	return { user, ctx, profile, providers: tp.config };
}

export interface AnonymousLocals {
	user?: undefined;
	ctx?: undefined;
	profile?: undefined;
	providers: SelvaConfig;
}

export function anon(tp: TestProviders): AnonymousLocals {
	return { providers: tp.config };
}

// ----------------------------------------------------------------------------
// Synthetic RequestEvent for direct +server.ts handler invocation.
// ----------------------------------------------------------------------------

type AnyHandler = (event: any) => unknown | Promise<unknown>;

export interface CallOpts {
	locals: unknown;
	params?: Record<string, string>;
	url?: string;
	body?: unknown;
	headers?: Record<string, string>;
	cookies?: Map<string, string>;
}

export interface CallResult {
	status: number;
	headers: Headers;
	json?: unknown;
	text?: string;
	location?: string;
}

/**
 * Invoke a `+server.ts` handler directly. Catches HttpError thrown by
 * `error()`/`redirect()` and translates them to a `CallResult`. Successful
 * Response objects are awaited and parsed as JSON when content-type matches.
 */
export async function call(handler: AnyHandler, opts: CallOpts): Promise<CallResult> {
	const url = new URL(opts.url ?? 'http://test.local/');
	const init: RequestInit = {
		method: opts.body !== undefined ? 'POST' : 'GET',
		headers: opts.headers ?? {}
	};
	if (opts.body !== undefined) {
		(init.headers as Record<string, string>)['content-type'] ??= 'application/json';
		init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
	}
	const request = new Request(url.toString(), init);
	const cookieMap = opts.cookies ?? new Map<string, string>();
	const event = {
		url,
		params: opts.params ?? {},
		request,
		locals: opts.locals,
		cookies: {
			get: (name: string) => cookieMap.get(name),
			set: (name: string, value: string) => cookieMap.set(name, value),
			delete: (name: string) => cookieMap.delete(name),
			getAll: () => Array.from(cookieMap.entries()).map(([name, value]) => ({ name, value }))
		},
		setHeaders: () => {},
		fetch,
		platform: undefined,
		route: { id: null },
		isDataRequest: false,
		isSubRequest: false
	};

	try {
		const result = (await handler(event)) as Response | undefined;
		if (!(result instanceof Response)) {
			return { status: 200, headers: new Headers() };
		}
		return await readResponse(result);
	} catch (err) {
		const httpErr = asHttpErrorLike(err);
		if (httpErr) {
			return {
				status: httpErr.status,
				headers: new Headers({ 'content-type': 'application/json' }),
				json: httpErr.body,
				location: httpErr.location
			};
		}
		throw err;
	}
}

async function readResponse(res: Response): Promise<CallResult> {
	const contentType = res.headers.get('content-type') ?? '';
	const out: CallResult = { status: res.status, headers: res.headers };
	if (res.headers.has('location')) out.location = res.headers.get('location')!;
	if (contentType.includes('application/json')) {
		const text = await res.text();
		out.text = text;
		try {
			out.json = text ? JSON.parse(text) : undefined;
		} catch {
			// leave as text
		}
	} else {
		out.text = await res.text();
	}
	return out;
}

/**
 * Assert that an awaited promise throws a SvelteKit HttpError with the given
 * status. Returns the error body for further assertions.
 *
 * Usage:
 *   const body = await expectHttpError(requireCanEdit(locals, project.id), 403);
 *   expect(body.message).toMatch(/permission/);
 */
export async function expectHttpError(
	promise: Promise<unknown>,
	expectedStatus: number
): Promise<{ message?: string }> {
	try {
		await promise;
	} catch (err) {
		const httpErr = asHttpErrorLike(err);
		if (!httpErr) throw err;
		if (httpErr.status !== expectedStatus) {
			throw new Error(
				`Expected HTTP ${expectedStatus} but got ${httpErr.status}: ${JSON.stringify(httpErr.body)}`
			);
		}
		return httpErr.body ?? {};
	}
	throw new Error(`Expected HTTP ${expectedStatus} but promise resolved`);
}

interface HttpErrorLike {
	status: number;
	body: { message?: string } | undefined;
	location?: string;
}

function asHttpErrorLike(err: unknown): HttpErrorLike | null {
	if (!err || typeof err !== 'object') return null;
	const e = err as Record<string, unknown>;
	if (
		typeof e.status === 'number' &&
		(typeof e.body === 'object' || typeof e.location === 'string')
	) {
		return {
			status: e.status,
			body: e.body as { message?: string } | undefined,
			location: typeof e.location === 'string' ? e.location : undefined
		};
	}
	return null;
}
