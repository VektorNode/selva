/**
 * The v1 contract, enforced.
 *
 * The registry and the OpenAPI document are just data until something checks
 * them against the routes that actually exist. Without these assertions
 * `x-internal` is an annotation someone remembers to write, "every collection
 * paginates" is a convention, and "404, never 403" holds only for as long as
 * the last reviewer was paying attention.
 *
 * Everything here reads route files as **text**. Importing a `+server.ts` would
 * pull in `./$types`, a SvelteKit build artifact that does not resolve under
 * vitest — and importing 27 modules to read their export names would be the
 * slow way to answer a question a regex answers exactly.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, sep, dirname } from 'node:path';
import { V1_ENDPOINTS, endpointKey, toRoutePath, type HttpMethod } from '../registry.js';
import { buildOpenApiDocument, toYaml, API_VERSION, API_BASE_PATH } from '../openapi.js';

const packageRoot = resolve(__dirname, '../../../../../..');
const v1Dir = resolve(packageRoot, 'src/routes/api/v1');
const adminDir = resolve(packageRoot, 'src/routes/api/admin');

const METHODS: HttpMethod[] = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];

function findServerFiles(dir: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			// `__tests__` holds test files, not routes.
			if (entry !== '__tests__') found.push(...findServerFiles(full));
		} else if (entry === '+server.ts') {
			found.push(full);
		}
	}
	return found;
}

function exportedMethods(source: string): HttpMethod[] {
	return METHODS.filter((m) => new RegExp(`export\\s+const\\s+${m}\\s*:`).test(source));
}

/** `.../v1/definitions/[guid]/solve/+server.ts` → `definitions/[guid]/solve`. */
function routePathOf(file: string, baseDir: string): string {
	return relative(baseDir, join(file, '..')).split(sep).join('/');
}

interface RouteFile {
	file: string;
	routePath: string;
	source: string;
	methods: HttpMethod[];
}

function loadRoutes(baseDir: string): RouteFile[] {
	return findServerFiles(baseDir).map((file) => {
		const source = readFileSync(file, 'utf8');
		return {
			file,
			routePath: routePathOf(file, baseDir),
			source,
			methods: exportedMethods(source)
		};
	});
}

const v1Routes = loadRoutes(v1Dir);
const adminRoutes = loadRoutes(adminDir);

// ============================================================================
// Route ↔ registry parity
// ============================================================================

describe('every route is in the registry, and every registry entry is a route', () => {
	const registryKeys = new Set(V1_ENDPOINTS.map((e) => endpointKey(e.method, e.path)));
	const routeKeys = new Set(
		v1Routes.flatMap((r) =>
			r.methods.map((m) => `${m} /${r.routePath}`.replace(/\[(\w+)\]/g, '{$1}'))
		)
	);

	it('has no undocumented route', () => {
		// A route missing from the registry is absent from the spec: shipped
		// surface no consumer can discover and no test constrains.
		const undocumented = [...routeKeys].filter((k) => !registryKeys.has(k));
		expect(undocumented).toEqual([]);
	});

	it('has no registry entry without a route', () => {
		// The opposite drift: a spec promising an endpoint that 404s.
		const missing = [...registryKeys].filter((k) => !routeKeys.has(k));
		expect(missing).toEqual([]);
	});

	it('found the routes at all', () => {
		// Guards the whole file: a wrong base path would make every assertion
		// above pass vacuously over an empty set.
		expect(v1Routes.length).toBeGreaterThan(20);
		expect(adminRoutes.length).toBeGreaterThan(10);
	});
});

// ============================================================================
// The committed spec matches the code
// ============================================================================

describe('openapi/v1.yaml', () => {
	const specPath = resolve(packageRoot, 'openapi/v1.yaml');

	it('takes info.version from the route prefix, not the package version', () => {
		// The package version bumps every release with `[skip ci]` and no
		// regeneration; deriving from the prefix means nobody has to remember.
		expect(API_VERSION).toBe('1.0.0');
		expect(API_BASE_PATH).toBe('/api/v1');

		const { version: pkgVersion } = JSON.parse(
			readFileSync(resolve(packageRoot, 'package.json'), 'utf8')
		) as { version: string };
		expect(API_VERSION).not.toBe(pkgVersion);
	});

	it('keeps the API major and the route prefix in lockstep', () => {
		// Shipping /api/v2 must move info.version too — a spec claiming 1.0.0 on
		// a v2 prefix is worse than no spec, because clients trust it.
		const prefixMajor = /v(\d+)$/.exec(API_BASE_PATH)?.[1];
		expect(API_VERSION.split('.')[0]).toBe(prefixMajor);
	});

	it('is committed and matches a fresh build', () => {
		const expected = toYaml(buildOpenApiDocument());

		// The spec is generated *here* rather than by a standalone script: the
		// generator needs `$lib` resolution and the workspace `source` condition,
		// which are configured for vitest. A second runner with its own resolver
		// could build the document from a different module graph than the check
		// that verifies it — so generate and verify share one.
		if (process.env.UPDATE_OPENAPI) {
			mkdirSync(dirname(specPath), { recursive: true });
			writeFileSync(specPath, expected, 'utf8');
			return;
		}

		expect(existsSync(specPath), 'openapi/v1.yaml is missing — run `pnpm openapi:generate`').toBe(
			true
		);
		// Regenerating on a validator change is not optional: a spec that lies
		// about a request shape is worse than no spec, because clients trust it.
		expect(
			readFileSync(specPath, 'utf8'),
			'openapi/v1.yaml is stale — run `pnpm openapi:generate`'
		).toBe(expected);
	});

	it('marks every internal endpoint and no public one', () => {
		const doc = buildOpenApiDocument('0.0.0') as {
			paths: Record<string, Record<string, { 'x-internal'?: boolean }>>;
		};
		for (const ep of V1_ENDPOINTS) {
			const op = doc.paths[`/api/v1${ep.path}`][ep.method.toLowerCase()];
			expect(op['x-internal'] ?? false, `${ep.method} ${ep.path}`).toBe(ep.internal ?? false);
		}
	});
});

// ============================================================================
// The docs page publishes only the public subset
// ============================================================================

describe('/docs/api', () => {
	it('never sends an internal endpoint to the browser', async () => {
		// The filtering runs in the load function, not the markup: hiding internal
		// endpoints in the template would still ship them in the page payload,
		// where they read as a promise to anyone who opens devtools.
		const { load } = await import('../../../../../routes/docs/api/+page.server.js');
		// The load takes no arguments it uses; the cast keeps the call honest
		// without constructing a full SvelteKit event.
		const data = (load as unknown as () => { groups: { endpoints: { path: string }[] }[] })();

		const published = new Set(
			data.groups.flatMap((g) => g.endpoints.map((e) => e.path.replace('/api/v1', '')))
		);
		const internal = V1_ENDPOINTS.filter((e) => e.internal).map((e) => e.path);

		expect(internal.length, 'no internal endpoints to check').toBeGreaterThan(0);
		for (const path of internal) {
			expect(published.has(path), `${path} is internal but reaches the docs page`).toBe(false);
		}
		expect(published.size).toBeGreaterThan(10);
	});
});

// ============================================================================
// Error envelope
// ============================================================================

describe('every failure carries an ApiErrorCode', () => {
	it.each(v1Routes.map((r) => [r.routePath, r] as const))('%s', (_name, route) => {
		// A bare `error(404)` produces `{ message }` with no `code`, so a client
		// branching on the code silently falls through to its default branch.
		// `apiError` and `handleApiError` are the two ways to raise one that has a
		// code; a direct `error(` call bypasses both.
		const bare = route.source.match(/(?<![\w.])error\s*\(/g) ?? [];
		expect(bare, `${route.routePath} raises a bare error() — use apiError()`).toEqual([]);
	});
});

// ============================================================================
// Pagination
// ============================================================================

describe('every collection endpoint paginates', () => {
	const collections = V1_ENDPOINTS.filter((e) => e.response === 'collection');

	it('found some to check', () => {
		expect(collections.length).toBeGreaterThan(5);
	});

	it.each(collections.map((e) => [endpointKey(e.method, e.path), e] as const))(
		'%s',
		(_name, ep) => {
			const route = v1Routes.find((r) => r.routePath === toRoutePath(ep.path));
			expect(route, `no route file for ${ep.path}`).toBeDefined();

			// The shared parser, not an inline clamp. Four endpoints once hand-rolled
			// this and all four drifted: they hardcoded the default limit, skipped
			// `Math.trunc` so `limit=5.9` reached the store, and silently ignored the
			// `orderBy`/`orderDir` the spec documents them as accepting. A handler
			// that clamps its own way publishes a different contract under the
			// documented one, and nothing else fails when it does.
			expect(
				/parse(Definition)?ListOptions\s*\(/.test(route!.source),
				`${ep.path} must paginate via parseListOptions, not an inline clamp`
			).toBe(true);
			expect(
				/searchParams\.get\(['"]limit['"]\)/.test(route!.source),
				`${ep.path} reads limit directly — use parseListOptions`
			).toBe(false);

			// The envelope. A resource-named key would force every client to write
			// one unwrapper per endpoint instead of one pagination helper.
			const usesHelper = /\b(collection|shapedCollection)\s*\(/.test(route!.source);
			const inlineEnvelope =
				/json\(\s*\{[\s\S]{0,400}?\bitems\b/.test(route!.source) &&
				/nextCursor/.test(route!.source);
			expect(
				usesHelper || inlineEnvelope,
				`${ep.path} does not return an { items, nextCursor? } envelope`
			).toBe(true);
		}
	);
});

// ============================================================================
// Existence concealment
// ============================================================================

describe('resource-addressed routes conceal existence', () => {
	// A 403 on a route addressed by a guessable id tells a caller that an id they
	// cannot reach exists. The behavioral proof lives in each route's own suite
	// (e.g. the solve endpoint's "404s a definition the caller cannot see"); what
	// this checks is that the registry never *documents* a 403 on such a route,
	// which is where the promise consumers read from would break first.
	//
	// `/me/*` is exempt: those paths address the caller's own profile, so there
	// is no other tenant's existence to disclose. Unstarring a guid the caller
	// cannot see is a no-op on their own row, and 204 is the honest answer.
	const guessableIdRoutes = V1_ENDPOINTS.filter(
		(e) =>
			/\{(guid|id|versionId|linkId)\}/.test(e.path) && !e.internal && !e.path.startsWith('/me/')
	);

	it('found some to check', () => {
		expect(guessableIdRoutes.length).toBeGreaterThan(5);
	});

	it.each(guessableIdRoutes.map((e) => [endpointKey(e.method, e.path), e] as const))(
		'%s documents 404 rather than 403',
		(_name, ep) => {
			const errors = ep.errors ?? [];
			if (errors.includes(403)) {
				// 403 is legitimate only alongside 404: "you can see it exists but may
				// not do that". A 403 with no 404 is an existence oracle.
				expect(
					errors.includes(404),
					`${ep.path} documents 403 without 404 — that discloses existence`
				).toBe(true);
			}
			expect(errors.includes(404), `${ep.path} must be able to answer 404`).toBe(true);
		}
	);
});

// ============================================================================
// Admin routes are platform-scoped
// ============================================================================

describe('every admin handler calls a platform-permission guard', () => {
	// The `/admin` layout guard never ran for endpoints — `+layout.server.ts`
	// does not execute for `+server.ts`. So "all admin routes guard themselves"
	// was true only by review until this test existed.
	//
	// Four helpers, not one: three named guards plus raw `requirePermission` with
	// a platform permission. `requireManageOrgMembers` is deliberately absent —
	// it is org-scoped, and the one admin route that used it moved to v1.
	// `requireAnyPlatformPermission` is absent too: it was the page-load variant
	// only, and no endpoint ever called it.
	const PLATFORM_PERMISSIONS = [
		'instance_admin',
		'manage_compute',
		'manage_instance_users',
		'manage_updates'
	];
	const NAMED_GUARDS = [
		'requireInstanceAdmin',
		'requireManageCompute',
		'requireManageInstanceUsers'
	];

	function guardsMethod(source: string, method: HttpMethod): boolean {
		// Slice from this handler's export to the next one, so a guard in a
		// sibling handler cannot vouch for an unguarded neighbour.
		const start = source.search(new RegExp(`export\\s+const\\s+${method}\\s*:`));
		if (start === -1) return false;
		const rest = source.slice(start + 1);
		const nextIdx = rest.search(/export\s+const\s+(GET|POST|PATCH|PUT|DELETE)\s*:/);
		const body = nextIdx === -1 ? rest : rest.slice(0, nextIdx);

		if (NAMED_GUARDS.some((g) => new RegExp(`\\b${g}\\s*\\(`).test(body))) return true;
		const raw = body.match(/requirePermission\s*\(\s*locals\s*,\s*['"]([\w]+)['"]/);
		return raw !== null && PLATFORM_PERMISSIONS.includes(raw[1]);
	}

	const cases = adminRoutes.flatMap((r) =>
		r.methods.map((m) => [`${m} ${r.routePath}`, r, m] as const)
	);

	it('found some to check', () => {
		expect(cases.length).toBeGreaterThan(20);
	});

	it.each(cases)('%s', (_name, route, method) => {
		expect(
			guardsMethod(route.source, method),
			`${method} /api/admin/${route.routePath} calls no platform-permission guard`
		).toBe(true);
	});
});
