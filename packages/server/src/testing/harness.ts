/**
 * A host-agnostic harness for testing API handlers.
 *
 * Handlers are transport-free, but the tests around them were not: they built
 * a SvelteKit `RequestEvent` and imported the Selva app's fixtures, so a second
 * host could run the handlers and inherit none of the tests proving they work.
 * That is the duplication this removes — a host wires a `TestHarness` once and
 * gets the shared suites.
 *
 * Two things stay injected because no interface supplies them:
 *   - {@link SeedAuthAdapter}, since identity has no portable creation method.
 *   - `mapError`, since folding a host's own domain errors into the envelope is
 *     by definition host-specific. Omitting it is not neutral: a host whose
 *     guards throw something `runHandler` does not recognize gets a 500 where
 *     production returns 403, and every status assertion silently weakens.
 */

import { randomUUID } from 'node:crypto';
import {
	SYSTEM_CONTEXT,
	DEFAULT_ORG_PERMISSIONS,
	emptyProfile,
	type AuthUser,
	type ILogger,
	type OrgMember,
	type OrgPermission,
	type OrgRole,
	type Organization,
	type PlatformPermission,
	type Project,
	type ProjectMember,
	type ProjectRole,
	type ProjectVisibility,
	type RequestContext,
	type SelvaConfig
} from '@selvajs/platform';
import { depsFromConfig, runHandler } from '../api/index.js';
import type { ApiError, ApiHandler, ApiRequest, SelvaDeps } from '../api/index.js';
import type { SeedAuthAdapter } from './seed-adapter.js';

export interface TestHarness {
	config: SelvaConfig;
	auth: SeedAuthAdapter;
	/** Folds host domain errors into the envelope, exactly as the host's adapter does. */
	mapError?: (err: unknown) => ApiError | undefined;
	/** Overrides merged onto the deps `callHandler` builds — token codecs, services, upload caps. */
	deps?: Partial<Pick<SelvaDeps, 'tokens' | 'uploadLimits' | 'services'>>;
	log?: ILogger;
}

/**
 * Swallows output unless `LOUD=1`.
 *
 * `runHandler` logs through `req.log` on the 500 path. Without a logger a test
 * that trips an unexpected 500 dies inside the error handler itself, which
 * hides the error that caused it.
 */
export const silentLog: ILogger = {
	error: (...args: unknown[]) => {
		if (process.env.LOUD) console.error('[test log]', ...args);
	},
	warn: () => {},
	info: () => {},
	debug: () => {},
	child: () => silentLog
} as unknown as ILogger;

// ============================================================================
// Seeders
// ============================================================================

export interface SeededUser {
	id: string;
	email: string;
}

export async function seedUser(
	h: TestHarness,
	email: string,
	platformPermissions: PlatformPermission[] = []
): Promise<SeededUser> {
	// Identity row then data-layer row, in that order — the sequence production
	// runs through its auth hook. Reversing it leaves a data row keyed to an id
	// no identity claims.
	const u = await h.auth.createUser(email);
	await h.config.data.ensureUser(SYSTEM_CONTEXT, u.id);
	if (platformPermissions.length > 0) {
		await h.config.data.permissions.set(SYSTEM_CONTEXT, u.id, platformPermissions);
	}
	// `AuthUser.email` is optional — a header-auth provider need not report one.
	// The seeded email is the caller's own input, so hand that back rather than
	// widening every test's `email` to `string | undefined`.
	return { id: u.id, email };
}

export async function seedOrg(
	h: TestHarness,
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
	await h.config.data.orgs.createOrg(SYSTEM_CONTEXT, org);
	return org;
}

export async function seedOrgMember(
	h: TestHarness,
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
	await h.config.data.orgs.addOrgMember(SYSTEM_CONTEXT, member);
	return member;
}

export async function seedProject(
	h: TestHarness,
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
	await h.config.data.projects.createProject(SYSTEM_CONTEXT, project);
	await h.config.data.projects.addProjectMember(SYSTEM_CONTEXT, {
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
	h: TestHarness,
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
	await h.config.data.projects.addProjectMember(SYSTEM_CONTEXT, member);
	return member;
}

// ============================================================================
// Acting identity
// ============================================================================

/**
 * The harness a `callHandler` call should build its deps from, carried on the
 * locals rather than passed alongside them.
 *
 * A test already threads `locals` from `actAs` into every call; making the
 * harness a second argument would mean passing the same two values everywhere
 * and would let them disagree — locals from one stack, deps from another, which
 * type-checks and silently tests nothing.
 */
const HARNESS = Symbol.for('@selvajs/server/testing.harness');

export interface ActingLocals {
	user: AuthUser;
	ctx: RequestContext;
	profile: ReturnType<typeof emptyProfile>;
	providers: SelvaConfig;
	log: ILogger;
	[HARNESS]?: TestHarness;
}

/**
 * Build the per-request identity a handler sees.
 *
 * Mirrors what a host's auth hook produces: one membership lookup, plus the
 * instance-admin fallback to the first listed org for an admin who belongs to
 * none. Keeping this aligned with the host is the point of testing against real
 * stores rather than mocks — a fixture that invented its own `ctx` would prove
 * the handler works under scope no request ever has.
 */
export async function actAs(h: TestHarness, userId: string): Promise<ActingLocals> {
	const user = await h.auth.findById(userId);
	if (!user) throw new Error(`actAs: user not found: ${userId}`);

	const platformPermissions = await h.config.data.permissions.getFor(SYSTEM_CONTEXT, user.id);
	const membership = await h.config.data.orgs.findUserMembership(SYSTEM_CONTEXT, user.id);
	let actingOrgId: string | undefined = membership?.org.id;
	const orgPermissions: OrgPermission[] = membership ? [...membership.member.permissions] : [];
	if (!actingOrgId && platformPermissions.includes('instance_admin')) {
		const firstOrgPage = await h.config.data.orgs.listOrgs(SYSTEM_CONTEXT, { limit: 1 });
		actingOrgId = firstOrgPage.items[0]?.id;
	}

	const profile =
		(await h.config.data.userProfile.getProfile(SYSTEM_CONTEXT, user.id)) ?? emptyProfile(user.id);

	return {
		user,
		ctx: { userId: user.id, actingOrgId, platformPermissions, orgPermissions },
		profile,
		providers: h.config,
		log: h.log ?? silentLog,
		[HARNESS]: h
	};
}

export function anon(h: TestHarness): { providers: SelvaConfig; [HARNESS]?: TestHarness } {
	return { providers: h.config, [HARNESS]: h };
}

// ============================================================================
// Handler invocation
// ============================================================================

export interface CallHandlerOpts {
	locals: unknown;
	params?: Record<string, string>;
	url?: string;
	body?: unknown;
	headers?: Record<string, string>;
}

export interface CallResult {
	status: number;
	headers: Headers;
	json?: unknown;
	text?: string;
	location?: string;
}

/**
 * Invoke an `ApiHandler` with no host framework in the loop.
 *
 * Still goes through `runHandler`, because that is the contract: it is what
 * turns a thrown `ApiError` — or a host error `mapError` recognizes — into a
 * status. Calling the handler bare would make every failure an exception and
 * every status assertion untestable.
 */
export async function callHandler(handler: ApiHandler, opts: CallHandlerOpts): Promise<CallResult> {
	const url = new URL(opts.url ?? 'http://test.local/');
	const init: RequestInit = {
		method: opts.body !== undefined ? 'POST' : 'GET',
		headers: opts.headers ?? {}
	};
	if (opts.body !== undefined) {
		// FormData carries its own multipart content-type with a generated
		// boundary; forcing JSON onto it makes `request.formData()` throw.
		if (opts.body instanceof FormData) {
			init.body = opts.body;
		} else {
			(init.headers as Record<string, string>)['content-type'] ??= 'application/json';
			init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
		}
	}

	const locals = opts.locals as Partial<ActingLocals> & { providers: SelvaConfig };
	const h = locals[HARNESS];
	if (!h) {
		// Without the harness there is no `mapError`, so every guard rejection
		// would fall through to a 500 and each expected 403 would read as a
		// passing-but-meaningless assertion. Fail loudly instead.
		throw new Error(
			'callHandler: locals carry no harness — build them with `actAs()` or `anon()`.'
		);
	}

	const req: ApiRequest = {
		ctx: locals.ctx,
		user: locals.user,
		profile: locals.profile,
		log: locals.log ?? h.log ?? silentLog,
		params: opts.params ?? {},
		url,
		request: new Request(url.toString(), init),
		deps: depsFromConfig(locals.providers, h.deps?.services ?? {}, {
			tokens: h.deps?.tokens,
			uploadLimits: h.deps?.uploadLimits
		})
	};

	return readResponse(await runHandler(handler, req, { fallback: 'Test', mapError: h.mapError }));
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
			// Leave it as text — a malformed body is the assertion's problem.
		}
	} else {
		out.text = await res.text();
	}
	return out;
}
