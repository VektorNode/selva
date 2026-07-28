// Data model for the /architecture page — the end-to-end solve flow and every
// cache on it. Facts are sourced from the code (file references on each entry);
// when the architecture changes, update the entry AND its file reference.

// ============================================================================
// Types
// ============================================================================

export type Mode = 'cloud' | 'local';
export type Provider = 'localfs' | 'supabase';

/** Which process a step runs in — drives the spine dot color + band label. */
export type Layer = 'browser' | 'selva-server' | 'compute-client' | 'rhino' | 'grasshopper';

export interface LayerInfo {
	id: Layer;
	label: string;
	sub: string;
	/** Tailwind classes for the spine node dot. */
	dot: string;
	/** Tailwind classes for the layer chip. */
	chip: string;
}

export interface CacheRef {
	/** id into CACHES */
	id: string;
	/** How this step uses the cache, one short clause. */
	note: string;
}

/** One discrete backend call a step makes (a DB read, storage fetch, etc.). */
export interface CallRef {
	/** e.g. "definitions.get" */
	name: string;
	/** what kind of call — drives the tag color. */
	kind: 'db' | 'storage' | 'network';
	/** where it goes, in plain words: "Postgres row", "Supabase storage", … */
	target: string;
	/** cache status of THIS call. `uncached` = hits the backend every solve. */
	cached: 'uncached' | 'cached';
	/** one short clause on what it fetches. */
	note: string;
}

export interface FlowStep {
	id: string;
	layer: Layer;
	title: string;
	/** One-line plain-language summary, always visible. */
	oneliner: string;
	/** Expanded plain-language explanation (2–5 sentences). */
	detail: string;
	/** Repo-relative file reference(s). */
	files: string[];
	/** Caches that act at this step. */
	caches?: CacheRef[];
	/** The discrete backend calls this step makes, in order (e.g. the 4 DB/blob reads). */
	calls?: CallRef[];
	/** A known optimization gap at this step (code-verified), surfaced as a callout. */
	gap?: string;
	/** Amber "flow control" badges — valves, not memory. */
	gates?: string[];
	/** Provider-dependent detail override (cloud mode only). */
	variants?: Partial<Record<Provider, { oneliner?: string; detail?: string; files?: string[] }>>;
}

export interface CacheEntry {
	id: string;
	name: string;
	layer: Layer | 'rhino-shared';
	/** What it remembers: key → value in plain words. */
	what: string;
	keyedBy: string;
	policy: string;
	invalidation: string;
	/** Per-process in-memory vs shared. */
	scope: 'per-tab' | 'per-process' | 'db-shared' | 'vm-shared';
	/** Ultra-short lifetime tag for the on-diagram chip, e.g. "5 min", "16 servers", "permanent". */
	lifetime: string;
	files: string[];
}

// ============================================================================
// Layers
// ============================================================================

export const LAYERS: Record<Layer, LayerInfo> = {
	browser: {
		id: 'browser',
		label: 'Browser',
		sub: '@selvajs/ui in the user’s tab',
		dot: 'bg-sky-500',
		chip: 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
	},
	'selva-server': {
		id: 'selva-server',
		label: 'Selva server',
		sub: 'SvelteKit app + @selvajs/server',
		dot: 'bg-emerald-500',
		chip: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
	},
	'compute-client': {
		id: 'compute-client',
		label: 'Compute client',
		sub: '@selvajs/compute — runs inside the Selva server process',
		dot: 'bg-cyan-500',
		chip: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400'
	},
	rhino: {
		id: 'rhino',
		label: 'Rhino.Compute VM',
		sub: 'headless Rhino + Grasshopper, separate machine',
		dot: 'bg-orange-500',
		chip: 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
	},
	grasshopper: {
		id: 'grasshopper',
		label: 'Grasshopper',
		sub: 'the live document in Rhino, via the Selva plugin',
		dot: 'bg-orange-500',
		chip: 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
	}
};

// ============================================================================
// Caches (the inventory table + the chips on the flow)
// ============================================================================

export const CACHES: CacheEntry[] = [
	{
		id: 'client-memo',
		name: 'Client solve memo',
		layer: 'browser',
		what: 'Stable hash of the solve input values → the finished solve result, sitting in front of the request/response driver. Dragging a slider back to a value already solved this session returns instantly — no request leaves the browser at all.',
		keyedBy: 'a stable, key-sorted serialization of the input values',
		policy:
			'LRU, max 16 entries, no TTL. Only completed solves are stored, so a hit is always a full result.',
		invalidation: 'clear() when the active definition changes; LRU age-out otherwise.',
		scope: 'per-tab',
		lifetime: '16 entries (LRU)',
		files: [
			'packages/ui/src/lib/compute/solveMemo.ts:42',
			'packages/ui/src/lib/compute/createSolveSession.svelte.ts:195'
		]
	},
	{
		id: 'texture',
		name: 'Texture cache',
		layer: 'browser',
		what: 'Texture key → decoded THREE.Texture, plus an in-flight map so concurrent loads of the same key share one download.',
		keyedBy: 'texture URL (content-hashed; long data-URIs are FNV-1a hashed)',
		policy:
			'LRU, max 64 entries, no TTL — safe because content-hashed keys never change meaning; an evicted texture is disposed.',
		invalidation:
			'LRU eviction; clearTextureCache() on viewer teardown bumps a generation guard so a load resolving after a clear is discarded.',
		scope: 'per-tab',
		lifetime: '64 entries (LRU)',
		files: ['packages/compute/src/features/visualization/webdisplay/texture-cache.ts:12']
	},
	{
		id: 'dvl',
		name: 'Value-list parse cache',
		layer: 'browser',
		what: 'Solved dynamic value-list payload string → parsed options, so a multi-MB option list isn’t re-parsed on every keystroke.',
		keyedBy: 'the raw payload JSON string (only strings ≥ 1 KB)',
		policy: 'LRU, max 8 entries, no TTL.',
		invalidation: 'LRU age-out only; lives for the page lifetime.',
		scope: 'per-tab',
		lifetime: '8 entries (LRU)',
		files: [
			'packages/ui/src/lib/schema/dynamic-value-list.ts:50',
			'packages/ui/src/lib/schema/dynamic-value-list.ts:51'
		]
	},
	{
		id: 'warm-client',
		name: 'Warm-client LRU',
		layer: 'selva-server',
		what: 'Compute-server id → a ready GrasshopperClient + SolveScheduler, so solves skip the connect/handshake. Shared by the solve route AND the definition-viewer render path.',
		keyedBy: 'server id (never the URL — ADR 0004)',
		policy: 'LRU, max 16 servers; evicted entry’s scheduler is disposed.',
		invalidation:
			'Explicit evict(id) when a server’s URL/key is rotated in admin — keyed on id, a stale entry would otherwise survive.',
		scope: 'per-process',
		lifetime: '16 servers (LRU)',
		files: [
			'packages/server/src/compute/client-cache.ts:146',
			'packages/selva/src/lib/server/compute/clientCache.server.ts:39'
		]
	},
	{
		id: 'def-bytes',
		name: 'Definition-byte cache',
		layer: 'selva-server',
		what: 'Version id → the .gh bytes, read lazily. The solve no longer eagerly pulls the blob off storage — the scheduler asks for bytes only when an upload is unavoidable, and a warm entry then serves them without touching storage. A pointer-known re-solve moves ZERO definition bytes.',
		keyedBy:
			'the immutable version id (never the fileKey — a delete-then-reupload can reuse a fileKey for different content)',
		policy:
			'LRU by total byte budget (default 256 MB, env COMPUTE_DEFINITION_BYTE_CACHE_MB; 0 disables). No TTL — version ids are immutable. An entry larger than the whole budget is served but never retained.',
		invalidation: 'Byte-budget LRU only; nothing ever goes stale.',
		scope: 'per-process',
		lifetime: '256 MB budget',
		files: [
			'packages/server/src/compute/definition-byte-cache.ts:93',
			'packages/selva/src/lib/server/compute/definitionByteCache.server.ts:19'
		]
	},
	{
		id: 'remote-def',
		name: 'Remote-definition cache',
		layer: 'selva-server',
		what: 'Remote definition URL → the fetched .gh bytes, so repeat solves of a URL-referenced definition skip the download (and its SSRF checks are behind the same door).',
		keyedBy: 'the definition URL',
		policy:
			'TTL (5 min default, env DEFINITION_CACHE_TTL_MS); max 50 entries, oldest 10 evicted in a batch.',
		invalidation: 'TTL expiry only.',
		scope: 'per-process',
		lifetime: '5 min TTL',
		files: ['packages/server/src/compute/remote-definition.ts:97']
	},
	{
		id: 'l2-solve',
		name: 'Durable solve cache (L2)',
		layer: 'selva-server',
		what: 'Full solve request → the finished, gzipped solve response, held in the Selva server. A hit returns the stored envelope without building a tree, calling compute, or re-serializing. OFF by default — an operator opts in with SOLVE_CACHE_PROVIDER=memory and a quota. Only live-channel, non-explicit-version local solves are eligible.',
		keyedBy:
			'(orgId, definitionId, versionId, inputKey) — org first for cross-tenant defense, version keys the keyspace to immutable bytes, plus the compute-server id (two servers can yield different geometry)',
		policy:
			'Two-dimensional eviction: a per-definition entry-count quota (default 0 = off, env SOLVE_CACHE_DEFAULT_MAX_ENTRIES) so one slider-heavy definition only churns its own entries, plus a global byte backstop (default 512 MB, env SOLVE_CACHE_MAX_TOTAL_MB). No TTL.',
		invalidation:
			'Count-quota + byte-backstop LRU; a publish is a fresh version keyspace so there is nothing to invalidate — old entries just age out.',
		scope: 'per-process',
		lifetime: 'quota + 512 MB',
		files: [
			'packages/server/src/compute/memory-solve-cache.ts:71',
			'packages/selva/src/lib/server/compute/solveCache.server.ts'
		]
	},
	{
		id: 'schema',
		name: 'Version schema cache',
		layer: 'selva-server',
		what: 'Definition version → its extracted UI schema, stored on the version row at upload time. Removes one of the two compute calls a page render used to make.',
		keyedBy: 'the version (its .gh bytes are immutable)',
		policy: 'Permanent — a version’s bytes never change, so its schema never expires.',
		invalidation:
			'Re-extracted on render if the stored schema version is stale (ADR 0005 — the stored schema is a disposable cache). A lazy backfill fills pre-cache versions on their next solve — bridge until ~2026-09.',
		scope: 'db-shared',
		lifetime: 'permanent',
		files: [
			'packages/server/src/definitions/definition-service.ts:121',
			'packages/server/src/definitions/load-for-render.ts:162'
		]
	},
	{
		id: 'sched-response',
		name: 'Solve response cache',
		layer: 'compute-client',
		what: 'Hash of (definition + input tree) → the full solve response. An identical re-solve is answered from memory — Rhino.Compute is never contacted.',
		keyedBy: 'stable hash of the .gh bytes + the exact input values',
		policy: 'LRU, max 20 entries, TTL 5 min (Selva’s override of the library default 50 / no TTL).',
		invalidation: 'TTL + LRU; dies with its warm client when that is evicted.',
		scope: 'per-process',
		lifetime: '5 min TTL · 20 entries',
		files: [
			'packages/compute/src/features/grasshopper/scheduler/solve-scheduler.ts:239',
			'packages/server/src/compute/client-cache.ts:229'
		]
	},
	{
		id: 'pointer-map',
		name: 'Definition pointer map',
		layer: 'compute-client',
		what: 'Hash of the .gh → the md5 cache key Rhino.Compute returned for it, so later solves send a tiny pointer instead of re-uploading a multi-MB definition.',
		keyedBy: 'hash of the definition bytes',
		policy: 'Bounded map, max 100, LRU-ish refresh on hit.',
		invalidation:
			'On a server-side miss the solve transparently re-uploads once and learns the fresh key; dropped when the server stops returning one.',
		scope: 'per-process',
		lifetime: '100 entries (LRU)',
		files: ['packages/compute/src/features/grasshopper/scheduler/solve-scheduler.ts:245']
	},
	{
		id: 'vm-def',
		name: 'Server definition cache',
		layer: 'rhino-shared',
		what: 'The uploaded .gh, parsed and held on the compute VM under an md5 key — the target the pointer map points at. A hit skips upload AND parse (decode ≈ 0 ms).',
		keyedBy: 'md5 of the definition',
		policy: 'Owned by Rhino.Compute; evicts on its own schedule.',
		invalidation:
			'The VM GCs independently; cache/purge does NOT clear it. A stale pointer just triggers one re-upload.',
		scope: 'vm-shared',
		lifetime: 'VM-managed',
		files: ['packages/compute/src/features/grasshopper/solve.ts:175 (miss → re-upload)']
	},
	{
		id: 'vm-solve',
		name: 'Server solve-result cache (cachesolve)',
		layer: 'rhino-shared',
		what: 'Identical request (definition + inputs) → the finished solve result, held on the compute VM. Survives Selva restarts and is shared by every Selva instance hitting that server. Errored solves are never cached unless cacheerroredsolves is opted in.',
		keyedBy: 'the full solve request',
		policy: 'Owned by Rhino.Compute; enabled per-request by the cachesolve flag Selva sends.',
		invalidation:
			'POST cache/purge (per child process — a multi-child fleet needs repeated purges).',
		scope: 'vm-shared',
		lifetime: 'VM-managed · survives restarts',
		files: [
			'packages/compute/src/features/grasshopper/solve.ts:299 (cachesolve flag)',
			'packages/compute/src/core/server/compute-server-stats.ts:318 (purge)'
		]
	}
];

// ============================================================================
// Flow controls — valves, not memory
// ============================================================================

export interface FlowControl {
	name: string;
	where: string;
	what: string;
	files: string[];
}

export const FLOW_CONTROLS: FlowControl[] = [
	{
		name: 'Input debounce',
		where: 'Browser',
		what: 'A slider fires after 150 ms of rest, typed input after 400 ms — keystrokes never become requests.',
		files: ['packages/ui/src/lib/components/preview/inputs/NumberInput.svelte:27']
	},
	{
		name: 'Solve throttle',
		where: 'Browser',
		what: 'One request in flight at a time; a newer value overwrites the single waiting slot ("latest wins") and stale in-flight requests are aborted. Stores no results.',
		files: ['packages/ui/src/lib/compute/computeThrottle.svelte.ts:27']
	},
	{
		name: 'Rate limiter',
		where: 'Selva server',
		what: 'Fixed-window counter per user or share link (default 120 requests / 100 s) → 429 with Retry-After. Counts requests, remembers nothing about results.',
		files: ['packages/server/src/compute/rate-limit.ts']
	},
	{
		name: 'Single-flight coalescer',
		where: 'Selva server',
		what: 'Concurrent identical live solves (same org + version + inputs) collapse into one pipeline run; every waiter is served that one result. A hot-key burst hits compute once. The shared run uses a non-aborting signal, so one caller disconnecting can’t cancel the solve for the others.',
		files: ['packages/server/src/compute/solve-cache-single-flight.ts']
	},
	{
		name: 'Scheduler queue',
		where: 'Compute client',
		what: 'Cloud solves run in queue mode: FIFO, one at a time per compute server, each runs to completion. (The plugin preview uses latest-wins instead.)',
		files: ['packages/server/src/compute/client-cache.ts:229']
	}
];

// ============================================================================
// Cloud-mode flow
// ============================================================================

export const CLOUD_STEPS: FlowStep[] = [
	{
		id: 'b-input',
		layer: 'browser',
		title: 'A slider moves',
		oneliner: 'Debounce holds fire until the hand rests — 150 ms for sliders, 400 ms for typing.',
		detail:
			'Every input change lands in the solve session’s value map, but nothing is sent yet. The debounce collapses a slider scrub into one final value, so dragging from 10 to 50 costs one solve, not forty.',
		files: ['packages/ui/src/lib/components/preview/inputs/NumberInput.svelte:47'],
		gates: ['debounce 150/400 ms']
	},
	{
		id: 'b-throttle',
		layer: 'browser',
		title: 'The solve throttle decides',
		oneliner:
			'One request in flight, latest values win — and a client memo answers a repeat value without touching the network.',
		detail:
			'If a solve is already running, the new values go into a single pending slot, overwriting whatever was waiting there. When the in-flight solve settles, the pending values fire — so the server only ever sees the newest state, and a slow solve can’t pile up requests behind it. Before firing, a small client-side memo (LRU 16, keyed on a stable hash of the input values) is consulted: dragging a slider back to a value already solved this session returns instantly, with no request leaving the browser at all.',
		files: [
			'packages/ui/src/lib/compute/computeThrottle.svelte.ts:27',
			'packages/ui/src/lib/compute/createSolveSession.svelte.ts:195'
		],
		gates: ['1 in flight · latest wins'],
		caches: [{ id: 'client-memo', note: 'repeat value → instant, no network' }]
	},
	{
		id: 'b-post',
		layer: 'browser',
		title: 'POST /api/compute',
		oneliner: 'The browser sends { inputs, values, definitionUrl } and advertises gzip.',
		detail:
			'A plain fetch with the definition reference (local:<guid> for stored definitions, an https URL for remote ones), the input parameter list, and the current values. The response handler maps 401 → login redirect, 429 → cooldown, 503 → “compute unavailable”.',
		files: ['packages/selva/src/routes/library/[guid]/+page.svelte:85']
	},
	{
		id: 's-gates',
		layer: 'selva-server',
		title: 'Gates: size, identity, rate',
		oneliner:
			'Body-size cap → share-token or login → rate limit. Rejected requests never touch the database.',
		detail:
			'The body cap rejects oversized payloads before buffering. A share-link token resolves to a synthetic identity; otherwise the session must be logged in. The rate limiter (fixed window per user/link) runs before any DB read, so throttled callers can’t burn database quota.',
		files: ['packages/selva/src/routes/api/compute/+server.ts:54'],
		gates: ['rate limit 120/100 s'],
		variants: {
			localfs: {
				detail:
					'The body cap rejects oversized payloads before buffering. Identity is an HMAC-signed session cookie checked by the local auth provider — no external service. The rate limiter (fixed window per user/link) runs before any file read.'
			},
			supabase: {
				detail:
					'The body cap rejects oversized payloads before buffering. Identity is a Supabase session JWT; a share-link token resolves to a synthetic identity instead. The rate limiter (fixed window per user/link) runs before any DB read, so throttled callers can’t burn Postgres quota.'
			}
		}
	},
	{
		id: 's-load',
		layer: 'selva-server',
		title: 'Load the definition',
		oneliner:
			'Three uncached DB reads for the rows — but the .gh blob is now read LAZILY through the definition-byte cache, not on every solve.',
		detail:
			'For a stored definition (local:guid) three rows are read in order: the definition record, its project (for the org + compute-server pin), and the live/draft version row. A permission check runs between the project read and the version read. These three rows still hit Postgres/disk on every solve. The .gh blob is different now: instead of an eager storage.get, the route hands the scheduler a byte-cache reference (keyed on the immutable version id) whose bytes are materialized ONLY when an upload is unavoidable — and even then a warm entry serves them without touching storage. A pointer-known re-solve moves zero definition bytes. This closed what used to be an optimization gap: the blob was re-read on every solve; now it isn’t. (The remote-definition cache still only guards the separate remote-URL branch. The version-schema cache saves a compute schema-extraction call on upload/render, not this fetch.)',
		files: ['packages/selva/src/routes/api/compute/+server.ts:198'],
		calls: [
			{
				name: 'definitions.get',
				kind: 'db',
				target: 'Postgres row (RLS)',
				cached: 'uncached',
				note: 'the definition record'
			},
			{
				name: 'projects.getProject',
				kind: 'db',
				target: 'Postgres row (RLS)',
				cached: 'uncached',
				note: 'org + compute-server pin'
			},
			{
				name: 'definitions.getVersion',
				kind: 'db',
				target: 'Postgres row (RLS)',
				cached: 'uncached',
				note: 'the live/draft version row'
			},
			{
				name: 'definitionRef.load()',
				kind: 'storage',
				target: 'Supabase storage',
				cached: 'cached',
				note: 'the version’s .gh bytes — lazy, byte-cached, skipped on a pointer-known re-solve'
			}
		],
		caches: [{ id: 'def-bytes', note: 'version id → .gh bytes; lazy, skipped on a pointer solve' }],
		variants: {
			localfs: {
				oneliner:
					'Three uncached JSON-file reads for the rows — the .gh blob is read lazily through the definition-byte cache, not on every solve.',
				detail:
					'With the local provider every store is a JSON file with atomic writes, and blobs live on disk next to them — same interfaces, same three row reads, just no database. The .gh blob is not read eagerly: the route hands the scheduler a byte-cache reference (keyed on the immutable version id) whose bytes load only when an upload is unavoidable, served warm without touching disk on a repeat. (The remote-definition cache only guards the separate remote-URL branch; the version-schema cache saves a compute call on upload, not this fetch.)',
				files: ['packages/providers/local/src/storage/LocalStorageProvider.ts:42']
			},
			supabase: {
				oneliner:
					'Three uncached Postgres row reads under RLS — the .gh blob is read lazily through the definition-byte cache, not on every solve.',
				detail:
					'Each request gets one of three Supabase clients, fail-closed: a system context gets the service-role client (bypasses RLS), a session token gets a JWT-header client (queries run as that user, RLS enforced), anything else gets the anon client — memoized per request. The three rows are fetched fresh every solve. The .gh blob is not: the route hands the scheduler a byte-cache reference (keyed on the immutable version id) that loads bytes only on an unavoidable upload and serves warm entries without touching storage. (The remote-definition cache only guards the separate remote-URL branch; the version-schema cache saves a compute call on upload, not this fetch.)',
				files: ['packages/providers/supabase/src/storage/SupabaseStorageProvider.ts:92']
			}
		}
	},
	{
		id: 's-resolve',
		layer: 'selva-server',
		title: 'Pick the compute server',
		oneliner: 'Definition pin → org default → global default. Narrowest wins.',
		detail:
			'A definition can pin a specific Rhino.Compute server; otherwise its org’s default applies, then the global default. Only servers visible to the org count. No visible server at all → 503 with “ask an admin” guidance.',
		files: ['packages/platform/src/computeServer/utils.ts:66']
	},
	{
		id: 's-warm',
		layer: 'selva-server',
		title: 'Grab the warm client',
		oneliner: 'The per-server LRU hands back a ready client — no handshake, no reconnect.',
		detail:
			'The first solve against a compute server creates a GrasshopperClient (one liveness probe) plus a queue-mode SolveScheduler, and caches the pair under the server’s id. Every later solve — and every definition-page render — reuses it. Rotating a server’s URL or key in admin explicitly evicts its entry.',
		files: ['packages/server/src/compute/client-cache.ts:239'],
		caches: [{ id: 'warm-client', note: 'server id → ready client + scheduler' }]
	},
	{
		id: 'p-tree',
		layer: 'selva-server',
		title: 'Build the input tree',
		oneliner: 'Values + parameter specs become the Grasshopper data tree for the wire.',
		detail:
			'Each input is normalized (number ranges, value lists, files, colors) and assembled into the tree structure Grasshopper expects. This is pure computation inside the solve pipeline — the transport-agnostic core extracted to @selvajs/server.',
		files: ['packages/server/src/compute/solve-pipeline.ts:145']
	},
	{
		id: 'c-cache',
		layer: 'compute-client',
		title: 'Response cache check',
		oneliner:
			'Two in-memory response caches short-circuit here: the durable L2 (if enabled) and the scheduler’s 5-minute response cache.',
		detail:
			'First, for an eligible live-channel solve, the pipeline consults the durable L2 cache (keyed on org + version + inputs); a hit returns the stored gzipped envelope without building a tree or calling compute — l2_cache;dur=1. If L2 is off or misses, the scheduler hashes the definition bytes together with the exact input tree; a hit there returns the stored response instantly as selva_cache;dur=1. Both are what make “wiggle a slider back to where it was” free server-side. The L2 is off by default — an operator opts in with SOLVE_CACHE_PROVIDER.',
		files: [
			'packages/compute/src/features/grasshopper/scheduler/solve-scheduler.ts:412',
			'packages/server/src/compute/solve-pipeline.ts:160'
		],
		caches: [
			{ id: 'l2-solve', note: 'durable HIT = stored envelope, no solve (if enabled)' },
			{ id: 'sched-response', note: 'HIT = instant response, no compute call' }
		]
	},
	{
		id: 'c-pointer',
		layer: 'compute-client',
		title: 'Upload or point?',
		oneliner:
			'A known definition is sent as a tiny md5 pointer instead of re-uploading megabytes of .gh.',
		detail:
			'The first solve uploads the definition; Rhino.Compute answers with a cache key. The pointer map remembers it, and every later solve sends just the key. If the server has meanwhile dropped the definition, the solve fails with definition_not_cached and the client transparently re-uploads once — visible as def_reupload;dur=1.',
		files: ['packages/compute/src/features/grasshopper/scheduler/solve-scheduler.ts:699'],
		caches: [{ id: 'pointer-map', note: 'definition hash → server-side md5 key' }]
	},
	{
		id: 'c-http',
		layer: 'compute-client',
		title: 'HTTP POST /grasshopper',
		oneliner:
			'The actual network hop: auth header, request id, definition-affinity header, retry with backoff.',
		detail:
			'One POST to the Rhino.Compute proxy with RhinoComputeKey auth, an X-Request-ID, and X-Selva-Definition carrying the definition guid (routing/telemetry metadata for a future server pool). Transient failures (429/502/503/504) retry with exponential backoff and jitter; the browser’s abort signal rides along, so closing the tab cancels the solve upstream.',
		files: ['packages/compute/src/core/compute-fetch/compute-fetch.ts:484']
	},
	{
		id: 'r-solve',
		layer: 'rhino',
		title: 'Rhino.Compute solves',
		oneliner:
			'Two VM-side caches first: the parsed definition (decode) and the finished result (cachesolve).',
		detail:
			'The VM keeps uploaded definitions parsed in memory — a pointer hit means decode ≈ 0 ms. With cachesolve on (Selva’s default), an identical request returns the stored result without re-running Grasshopper at all — solve ≈ 0 ms. Both survive Selva restarts and are shared by every client of that server. Otherwise headless Grasshopper actually solves.',
		files: ['packages/compute/src/features/grasshopper/solve.ts:299'],
		caches: [
			{ id: 'vm-def', note: 'parsed .gh held under its md5 key' },
			{ id: 'vm-solve', note: 'identical request → stored result' }
		]
	},
	{
		id: 'p-out',
		layer: 'selva-server',
		title: 'Package the response',
		oneliner: 'Size-guard → gzip → Server-Timing header that names where every millisecond went.',
		detail:
			'The result is serialized once (an oversized file output becomes a clean 413 instead of a crash), gzipped when the browser accepts it, and stamped with Server-Timing: load/tree/solve/serialize/gzip plus rhino_decode/rhino_solve/rhino_encode from the VM and the cache verdicts selva_cache and def_reupload. Open devtools → Network → Timing and you can read exactly which caches hit.',
		files: ['packages/server/src/compute/solve-pipeline.ts:140']
	},
	{
		id: 'b-render',
		layer: 'browser',
		title: 'Render',
		oneliner: 'Parse JSON, extract meshes, hand them to the three.js viewer.',
		detail:
			'The browser splits its own round-trip timing (ttfb/download/parse) against the Server-Timing header to attribute latency. Meshes go to the WebDisplay viewer; textures load through the texture cache so a re-render never re-decodes an image, and huge value-list payloads parse once through their own small LRU.',
		files: ['packages/selva/src/routes/library/[guid]/+page.svelte:142'],
		caches: [
			{ id: 'client-memo', note: 'this result is memoized for a value re-visit' },
			{ id: 'texture', note: 'decoded textures reused across solves' },
			{ id: 'dvl', note: 'multi-MB option lists parsed once' }
		]
	}
];

// ============================================================================
// Local-mode flow (plugin preview over WebSocket)
// ============================================================================

export const LOCAL_STEPS: FlowStep[] = [
	{
		id: 'l-input',
		layer: 'browser',
		title: 'A slider moves',
		oneliner: 'Value updates batch in a 50 ms window and queue while Grasshopper is mid-solve.',
		detail:
			'The plugin preview UI collects value changes for 50 ms and sends them as one update. If Grasshopper is still solving, updates keep queueing — when the solve finishes, only the latest state is applied. The same client-side solve memo (LRU 16) the cloud path uses sits in front of the driver here too: a value already solved this session is served from memory without touching the socket.',
		files: [
			'packages/plugin-ui/src/lib/websocket/websocket.svelte.ts:337',
			'packages/ui/src/lib/compute/createSolveSession.svelte.ts:195'
		],
		gates: ['50 ms batch · latest wins'],
		caches: [{ id: 'client-memo', note: 'repeat value → served from memory, no socket send' }]
	},
	{
		id: 'l-ws',
		layer: 'browser',
		title: 'WebSocket to localhost:8765',
		oneliner: 'One socket straight into the Grasshopper plugin — no HTTP, no auth, no database.',
		detail:
			'The browser connects to ws://localhost:8765, served by the C# WebSocketServer inside the Selva plugin (it falls back to a free port if 8765 is taken). This is a push transport: there is no request/response pairing and cancel is a no-op — newer values simply supersede.',
		files: [
			'packages/plugin-ui/src/lib/websocket/websocket.svelte.ts:220',
			'Plugin/Selva.GH/Features/UIBuilder/Services/Communication/WebSocketServer.cs:51'
		]
	},
	{
		id: 'l-solve',
		layer: 'grasshopper',
		title: 'Grasshopper solves the live document',
		oneliner: 'The definition is already open in Rhino — no upload, no parse, no compute server.',
		detail:
			'The plugin writes the values into the linked parameters and Grasshopper re-solves the open document in-process. Everything the cloud path does to move the definition to a machine that can solve it simply doesn’t exist here.',
		files: ['Plugin/Selva.GH/Features/UIBuilder/']
	},
	{
		id: 'l-push',
		layer: 'grasshopper',
		title: 'Results push back',
		oneliner:
			'A JSON outputs envelope followed by binary mesh frames, streamed over the same socket.',
		detail:
			'Outputs arrive as one JSON message plus trailing binary frames carrying the meshes in the SLVA wire format — no base64 inflation. The UI parses the batches and reports them into the same solve session the cloud path uses.',
		files: ['packages/plugin-ui/src/lib/schema-source/websocket-solve-driver.ts:111']
	},
	{
		id: 'l-render',
		layer: 'browser',
		title: 'Render',
		oneliner: 'Same viewer, same browser-side caches as cloud mode.',
		detail:
			'The mesh batches land in the same WebDisplay viewer. The texture cache and value-list parse cache work identically — they belong to the viewer, not the transport.',
		files: ['packages/plugin-ui/src/lib/schema-source/websocket-solve-driver.ts:133'],
		caches: [
			{ id: 'client-memo', note: 'this result is memoized for a value re-visit' },
			{ id: 'texture', note: 'decoded textures reused across solves' },
			{ id: 'dvl', note: 'multi-MB option lists parsed once' }
		]
	}
];

// ============================================================================
// Server-Timing legend — how to SEE the caches per request
// ============================================================================

export interface TimingEntry {
	metric: string;
	meaning: string;
}

export const SERVER_TIMING: TimingEntry[] = [
	{ metric: 'load', meaning: 'auth + DB reads + definition fetch, before the solve' },
	{ metric: 'tree', meaning: 'building the Grasshopper input tree' },
	{ metric: 'solve', meaning: 'the full solve wall time as the Selva server saw it' },
	{
		metric: 'rhino_decode / rhino_solve / rhino_encode',
		meaning: 'time ON the compute VM (≈0 decode = definition cache hit; ≈0 solve = cachesolve hit)'
	},
	{
		metric: 'compute_link',
		meaning: 'solve minus rhino_* — network + queue between Selva and the VM'
	},
	{
		metric: 'l2_cache;dur=1',
		meaning:
			'served from the durable L2 solve cache — no tree build, no compute (dur=0 = consulted then solved; absent = not eligible)'
	},
	{
		metric: 'selva_cache;dur=1',
		meaning: 'served from the scheduler’s in-process response cache — compute never called'
	},
	{
		metric: 'def_bytes;desc=skipped|hit|miss',
		meaning:
			'byte-cache verdict — skipped = pointer solve moved no .gh bytes; hit = warm byte cache; miss = read from storage'
	},
	{
		metric: 'def_reupload;dur=1',
		meaning: 'the pointer was stale; the .gh was re-uploaded this solve'
	},
	{
		metric: 'serialize / gzip / total',
		meaning: 'packaging the response; total = server wall time, so browser ttfb − total ≈ network'
	},
	{
		metric: 'p_*',
		meaning:
			'prep sub-phases (body parse, share token, DB reads, blob…) — names the step a load spike hides in'
	}
];
