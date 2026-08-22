/**
 * Test fixtures for @selvajs/selva integration tests.
 *
 * `freshProviders()` builds a real LocalDataProvider stack rooted in a fresh
 * tmpdir per test — no mocks, no stubs. Tests interact with the same store
 * implementations production uses; only the wiring (provider singleton vs.
 * per-test handle) differs.
 *
 * `setTestProviders()` from ./test-providers makes the stack visible to the
 * mocked `$lib/server/providers.server` so route handlers and access helpers
 * see this test's providers when they call `getProjectProvider()` etc.
 *
 * **Workspace packages resolve through `dist/`, not source.** Tests here import
 * `@selvajs/platform` and `@selvajs/local-provider` as built artifacts, so
 * editing a rule in `packages/platform/src` changes nothing until that package
 * is rebuilt. This matters most when checking a test by breaking the code it
 * guards: a source-only edit leaves the suite green and reads as a vacuous
 * test when it is really a stale build. Rebuild the package first.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
	LocalAuthProvider,
	LocalDataProvider,
	LocalStorageProvider,
	createLocalAuthUserStore
} from '@selvajs/local-provider';
import {
	type AuthUser,
	type DomainEvent,
	type IEventSink,
	type IOAuthAuth,
	type ISessionRefresh,
	type SelvaConfig,
	type SelvaFlags,
	type TenancyMode
} from '@selvajs/platform';
import { DefinitionService } from '@selvajs/server/definitions';
import type { TestHarness, CallResult } from '@selvajs/server/testing';
import { actAs as actAsShared, silentLog } from '@selvajs/server/testing';
import { isApiError } from '@selvajs/server/api';
import { mapAppError } from '../api/sveltekit.js';
import { shareLinkCodec } from '../shareLinks/token.server.js';
import { inviteCodec } from '../invites/token.server.js';
import { setTestProviders, clearTestProviders } from './test-providers.js';
import { accessDepsFromConfig, type AccessDeps } from '../access.server.js';

const TEST_HMAC_KEY = 'test-hmac-key-32-chars-min-length';
// Deterministic 32-byte hex — `LocalComputeServerStore.fromEnv` needs a key
// to encrypt the per-server compute config. Tests don't read the encrypted
// blob, but the constructor still requires one.
const TEST_AT_REST_KEY = '0'.repeat(64);

// ============================================================================
// Provider stack
// ============================================================================

/** Keeps every emitted event so a test can assert an audit trail exists. */
class RecordingEventSink implements IEventSink {
	readonly events: DomainEvent[] = [];
	async emit(event: DomainEvent): Promise<void> {
		this.events.push(event);
	}
}

/**
 * Extends `TestHarness` so the shared seeders in `@selvajs/server/testing`
 * accept it directly. The extra fields are this host's: `authUsers` is the
 * local provider's identity file, which the auth and admin route tests read
 * directly and no interface exposes.
 */
export interface TestProviders extends TestHarness {
	root: string;
	config: SelvaConfig;
	tenancy: TenancyMode;
	flags: SelvaFlags;
	definitionService: DefinitionService;
	/** Identity-only file (auth-users.json). Shaped like the auth provider's view. */
	authUsers: ReturnType<typeof createLocalAuthUserStore>;
	/** Every event emitted since `freshProviders`, in order. */
	events: DomainEvent[];
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

	const events = new RecordingEventSink();
	const auth = LocalAuthProvider.fromEnv(env);
	const data = LocalDataProvider.fromEnv(env, events);
	const storage = LocalStorageProvider.fromEnv(env);
	// Reuse the provider's OWN store (not a second one on the same file) so seed
	// helpers share its load-once write-through cache — otherwise seeds via this
	// handle wouldn't be visible to the provider's verifyToken/verifyLogin. §3a.
	const authUsers = auth.userStore;
	if (!authUsers) throw new Error('LocalAuthProvider has no user store (DATA_PATH unset in tests)');

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
		// --- TestHarness ---
		// `null` password marks an OAuth-allowlisted entry; tests don't
		// authenticate, they just need the ids to align across stores.
		auth: {
			createUser: (email) => authUsers.createUser(email, null),
			findById: (id) => authUsers.findById(id)
		},
		mapError: mapAppError,
		deps: {
			// The app's own codecs, not fresh ones: a second codec would hash under
			// a different secret than the seeders use, so every token lookup would
			// miss and read as a broken handler rather than a broken fixture.
			tokens: { shareLinks: shareLinkCodec(), invites: inviteCodec() },
			services: { definitions: definitionService }
		},
		log: silentLog,
		events: events.events,
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

/**
 * The basic seeders live in `@selvajs/server/testing` and are re-exported here
 * so this module stays the single import for tests. They take a `TestHarness`,
 * which `TestProviders` extends — call sites pass `tp` unchanged.
 */
export {
	seedUser,
	seedOrg,
	seedOrgMember,
	seedProject,
	seedProjectMember,
	seedDefinition,
	seedShareLink,
	grantPlatformPermissions,
	anon,
	callHandler,
	silentLog
} from '@selvajs/server/testing';
export type {
	SeededUser,
	SeededDefinition,
	SeededShareLink,
	ActingLocals,
	CallHandlerOpts,
	CallResult
} from '@selvajs/server/testing';

/**
 * The shared `actAs`, plus this app's `deps`.
 *
 * `access.server.ts` guards read their stores off `locals.deps`, which is a
 * Selva concept — the shared harness knows only what a handler reads. Page
 * loads and the guard unit tests both pass these locals straight to a guard, so
 * the field has to be here rather than added per test.
 */
export async function actAs(
	tp: TestProviders,
	userId: string
): Promise<Awaited<ReturnType<typeof actAsShared>> & { deps: AccessDeps }> {
	return { ...(await actAsShared(tp, userId)), deps: accessDepsFromConfig(tp.config) };
}

// ============================================================================
// Definitions + share links
// ============================================================================

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
 * Augment the test's auth provider with a `sessionRefresh` capability that
 * records which tokens were revoked. The local provider mints stateless HMAC
 * tokens and so exposes none — Supabase does, and it is the provider whose
 * sessions outlive cookie deletion.
 */
export function installSessionRefreshShim(tp: TestProviders): { revoked: string[] } {
	const state = { revoked: [] as string[] };
	const shim: ISessionRefresh = {
		async refreshSession() {
			throw new Error('sessionRefresh shim: refreshSession not implemented for tests');
		},
		async revokeSession(token: string) {
			state.revoked.push(token);
			return true;
		}
	};
	(tp.config.auth as { sessionRefresh?: ISessionRefresh }).sessionRefresh = shim;
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

/**
 * The tenant casts moved to `@selvajs/server/testing` alongside the handler
 * tests that use them. Re-exported here so this module stays the single import
 * for tests; they take a `TestHarness`, which `TestProviders` extends, so call
 * sites pass `tp` unchanged.
 */
export { seedAcme, seedBigClient, seedThirdOrg, seedCommons } from '@selvajs/server/testing';
export type {
	AcmeFixture,
	BigClientFixture,
	ThirdOrgFixture,
	CommonsFixture
} from '@selvajs/server/testing';

/**
 * Wrap one store method to observe that it was called, leaving behaviour intact.
 *
 * Proxies rather than spreads. The stores are class instances, so
 * `{ ...store, method: spy }` copies own properties and drops every prototype
 * method — the resulting object throws `store.getProject is not a function` at
 * the first untouched call, which surfaces as an opaque 500 rather than a
 * pointer at the spread.
 *
 * This is what proves a handler reads `req.deps` instead of a module global:
 * the global still holds the unwrapped store, so a handler that reaches for it
 * never trips the spy.
 */
export function spyOnStore<
	K extends keyof SelvaConfig['data'],
	M extends keyof SelvaConfig['data'][K]
>(config: SelvaConfig, store: K, method: M, onCall: () => void): SelvaConfig {
	const real = config.data[store];
	const spied = new Proxy(real as object, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (prop === method) {
				return (...args: unknown[]) => {
					onCall();
					return (value as (...a: unknown[]) => unknown).apply(target, args);
				};
			}
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
	return {
		...config,
		data: new Proxy(config.data, {
			get: (target, prop, receiver) =>
				prop === store ? spied : Reflect.get(target, prop, receiver)
		})
	};
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

// `CallResult` is the shared one, re-exported above — `call` and `callHandler`
// return the same shape so a test converts between them without touching its
// assertions.

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
		// FormData sets its own multipart content-type with a generated boundary;
		// forcing `application/json` onto it makes `request.formData()` throw.
		if (opts.body instanceof FormData) {
			init.body = opts.body;
		} else {
			(init.headers as Record<string, string>)['content-type'] ??= 'application/json';
			init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
		}
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
	body: { message?: string; code?: string } | undefined;
	location?: string;
}

function asHttpErrorLike(err: unknown): HttpErrorLike | null {
	if (!err || typeof err !== 'object') return null;
	// The access guards raise `ApiError`, which carries `message`/`code` as own
	// fields rather than under `body`. Production folds it into the envelope at
	// the boundary (`mapAppError`, or `asHttpError` off the mounted path); these
	// helpers call guards directly, so they normalize it here.
	if (isApiError(err)) {
		return { status: err.status, body: { message: err.message, code: err.code } };
	}
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
