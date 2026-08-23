/**
 * The v1 contract, enforced.
 *
 * The registry and the OpenAPI document are just data until something checks
 * them against the routes that actually exist. Without these assertions
 * `x-internal` is an annotation someone remembers to write, "every collection
 * paginates" is a convention, and "404, never 403" holds only as long as the
 * last reviewer was paying attention.
 *
 * Everything here reads route files as **text** — importing a `+server.ts`
 * would pull in `./$types`, a SvelteKit build artifact that doesn't resolve
 * under vitest.
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

const handlersDir = resolve(packageRoot, 'src/lib/server/api/handlers');
// Handlers are moving into `@selvajs/server`; a route mounts them by named
// import from the package barrel rather than by path. Resolved through the
// workspace source, not `dist`, so the assertions read what a change edited.
const packageHandlersDir = resolve(packageRoot, '../server/src/handlers');

/**
 * Drop comments before any source grep.
 *
 * Every assertion below greps for a call shape, and prose naming that shape —
 * `// throws SvelteKit's error()` — matches just as well as a call does. The
 * obvious fix to a false positive is rewording the comment, which leaves the
 * next author to hit the same wall.
 */
function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Every module a route mounts a handler from, whether it still lives in the app
 * or has moved into `@selvajs/server/handlers`.
 *
 * A package import names the exported functions, not the file, so the barrel
 * is what maps one to the other. Unresolvable is a hard failure rather than an
 * empty string — silently inlining nothing would leave every source-grep
 * assertion below passing vacuously against a one-line route file.
 */
function mountedSources(source: string): string[] {
	const appImports = [...source.matchAll(/from\s+'\$lib\/server\/api\/handlers\/([\w.-]+)'/g)];
	const bodies = appImports.map(([, name]) => {
		const file = join(handlersDir, `${name}.ts`);
		if (!existsSync(file)) throw new Error(`route mounts a missing handler module: ${file}`);
		return readFileSync(file, 'utf8');
	});

	for (const [, names] of source.matchAll(
		/import\s*\{([^}]*)\}\s*from\s+'@selvajs\/server\/handlers'/g
	)) {
		for (const name of names.split(',').map((n) => n.trim().replace(/^type\s+/, ''))) {
			if (name) bodies.push(readFileSync(packageHandlerFile(name), 'utf8'));
		}
	}
	return bodies;
}

/**
 * The source file behind one export of `@selvajs/server/handlers`.
 *
 * Reads whole `export { … } from './mod.js'` statements rather than lines: the
 * barrel wraps long lists across lines, and a line-wise match finds the names
 * but not the `from` that says where they came from.
 */
function packageHandlerFile(exportName: string): string {
	const barrel = readFileSync(join(packageHandlersDir, 'index.ts'), 'utf8');
	for (const [, names, module] of barrel.matchAll(
		/export\s*\{([^}]*)\}\s*from\s+'\.\/([\w.-]+)\.js'/g
	)) {
		const exported = names.split(',').map((n) => n.trim().replace(/^type\s+/, ''));
		if (exported.includes(exportName)) return join(packageHandlersDir, `${module}.ts`);
	}
	throw new Error(`@selvajs/server/handlers does not export ${exportName} — barrel out of date?`);
}

function withMountedHandlers(source: string): string {
	return stripComments([source, ...mountedSources(source)].join('\n'));
}

function loadRoutes(baseDir: string): RouteFile[] {
	return findServerFiles(baseDir).map((file) => {
		const source = readFileSync(file, 'utf8');
		return {
			file,
			routePath: routePathOf(file, baseDir),
			source: withMountedHandlers(source),
			// From the route file itself — a handler module exports functions, not HTTP verbs.
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
	// cannot reach exists. The behavioral proof lives in each route's own suite;
	// this checks that the registry never *documents* a 403 on such a route,
	// which is where consumers' promise would break first.
	//
	// `/me/*` is exempt: those paths address the caller's own profile, so there
	// is no other tenant's existence to disclose.
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
	// `+layout.server.ts`'s guard never runs for `+server.ts` endpoints, so each
	// admin handler must guard itself.
	//
	// Four helpers, not one: three named guards plus raw `requirePermission` with
	// a platform permission. `requireManageOrgMembers` is deliberately absent —
	// it is org-scoped, and the one admin route that used it moved to v1.
	// `requireAnyPlatformPermission` is absent too: it's the page-load variant,
	// and no endpoint calls it.
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

// ============================================================================
// Both API surfaces share one handler wrapper
// ============================================================================

/**
 * `/api/v1/*` and `/api/admin/*` are siblings over one core, so a rule that
 * lands in the shared helpers must reach both.
 *
 * Exempt by nature, not by neglect: handlers that return a stream own their own
 * error signalling, because the status line is already sent by the time
 * anything can fail. `apiRoute` cannot help them, and wrapping them would hide
 * that.
 */
describe('every API handler is wrapped (v1: mount; admin: apiRoute or mount)', () => {
	const STREAMING_EXEMPT = new Set([
		'POST api/admin/system/update', // SSE — errors are `sendEvent`'d into the stream
		'GET api/admin/system/update', // returns the tee'd log as text/plain
		'GET api/admin/system/throughput', // streams random bytes downstream
		'POST api/admin/system/throughput', // reads the body as a stream
		'GET api/admin/system/health', // every check self-reports its own status
		'GET api/admin/compute', // maps its catch to a deliberate logged 500
		'PUT api/admin/compute',
		'POST api/admin/compute/actions',
		'GET api/admin/compute/status',
		'POST api/v1/compute', // solve paths: streaming + their own metric marks
		'POST api/v1/compute/schema',
		'POST api/v1/definitions/[guid]/solve'
	]);

	// `apiRoute` wraps a SvelteKit handler; `mount` wraps a transport-free one
	// from `api/handlers/` and routes its errors through `runHandler`. Both
	// guarantee the structured envelope, which is what this asserts.
	//
	// v1 accepts only `mount` — allowing `apiRoute` there would let a new route
	// pick a wrapper that can't be mounted by a second host. Admin still
	// accepts either, since those handlers haven't converted yet.
	function wrapsMethod(source: string, method: HttpMethod, prefix: string): boolean {
		const wrappers = prefix === 'api/v1' ? 'mount' : '(?:apiRoute|mount)';
		return new RegExp(`export\\s+const\\s+${method}\\s*:[^=]*=\\s*${wrappers}\\s*\\(`).test(source);
	}

	const withPrefix = [
		...v1Routes.map((r) => ({ ...r, prefix: 'api/v1' })),
		...adminRoutes.map((r) => ({ ...r, prefix: 'api/admin' }))
	];

	const cases = withPrefix.flatMap((r) =>
		r.methods
			.map((m) => [`${m} ${r.prefix}/${r.routePath}`, r, m] as const)
			.filter(([name]) => !STREAMING_EXEMPT.has(name))
	);

	it('found some to check', () => {
		expect(cases.length).toBeGreaterThan(40);
	});

	it('every exemption names a route that still exists', () => {
		// An exemption for a deleted route silently excuses nothing; an exemption
		// for a route that was later converted hides a passing case.
		const shipped = new Set(
			withPrefix.flatMap((r) => r.methods.map((m) => `${m} ${r.prefix}/${r.routePath}`))
		);
		expect([...STREAMING_EXEMPT].filter((e) => !shipped.has(e))).toEqual([]);
	});

	it.each(cases)('%s', (_name, route, method) => {
		const required = route.prefix === 'api/v1' ? 'mount' : 'apiRoute or mount';
		expect(
			wrapsMethod(route.source, method, route.prefix),
			`${method} ${route.prefix}/${route.routePath} is not wrapped in ${required} — ` +
				'an unhandled error there becomes a raw 500 carrying a provider message'
		).toBe(true);
	});
});

// ============================================================================
// The permissions spec lists every route
// ============================================================================

/**
 * `docs/contributing/permissions.md` §8 is a table — endpoint, method, governing
 * rule — which makes it the one part of a 770-line prose document a test can hold.
 *
 * The registry↔route check above catches an undocumented *contract*. This
 * catches an unreviewed *authorization decision*: a route can be fully
 * registered and documented in OpenAPI while nobody has written down who may
 * call it.
 *
 * Deliberately one-directional: a matrix row with no route is fine, because §8
 * documents unbuilt endpoints on purpose (`GET /api/v1/projects` is marked "not
 * implemented yet"). The direction that matters is shipped-but-unlisted.
 */
describe('permissions.md §8 lists every route', () => {
	const matrix = readFileSync(
		resolve(packageRoot, '../../docs/contributing/permissions.md'),
		'utf8'
	);

	/**
	 * Rows look like `| \`/api/v1/orgs/[orgId]/members\` | \`GET/PATCH\` | … |`.
	 * Paths keep SvelteKit's `[param]` here rather than OpenAPI's `{param}`, a
	 * single row may cover several methods, and `*` means "every method on this
	 * path" — used where one permission governs the whole resource.
	 */
	const documented = new Set<string>();
	for (const [, path, methods] of matrix.matchAll(
		/^\|\s*`(\/api\/[^`]+)`\s*\|\s*`([A-Z/*]+)`\s*\|/gm
	)) {
		const listed = methods === '*' ? METHODS : (methods.split('/') as HttpMethod[]);
		for (const method of listed) documented.add(`${method} ${path}`);
	}

	const cases = [
		...v1Routes.flatMap((r) => r.methods.map((m) => [`${m} /api/v1/${r.routePath}`] as const)),
		...adminRoutes.flatMap((r) => r.methods.map((m) => [`${m} /api/admin/${r.routePath}`] as const))
	];

	it('parsed the matrix at all', () => {
		// Without this the whole describe passes vacuously if the table format
		// changes — the failure mode this file exists to prevent.
		expect(documented.size).toBeGreaterThan(30);
	});

	it.each(cases)('%s is in the matrix', (key) => {
		expect(documented.has(key), `${key} ships but §8 never says who may call it`).toBe(true);
	});
});
