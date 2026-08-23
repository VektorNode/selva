import type { RequestContext } from '../context.js';

/**
 * Shared solve-result cache seam, keyed on `(orgId, definitionId, versionId,
 * inputKey)` where `inputKey` is a wide (SHA-256) hash of the transformed input
 * tree plus the solve-affecting config subset. A hit skips compute entirely.
 *
 * Design contract:
 *
 * - **Async from day one.** The in-memory backend returns promises too, so a
 *   network store (Redis) drops in later without any call site changing shape.
 * - **Entries are opaque bytes** — the pre-gzipped response envelope plus a
 *   small metadata header. The backend never inspects them, so a hit stays
 *   near-CPU-free in either backend and there's no serialization drift between
 *   implementations.
 * - **Best-effort.** `get` may miss at any time (restart, eviction, network
 *   blip); `set` may silently drop. Correctness never depends on cache presence
 *   — this is what makes the no-TTL/versionId keying safe under any eviction
 *   policy.
 * - **Per-definition quota, passed at write time.** `set` carries
 *   `maxEntriesForDefinition` so the backend holds no policy, only data.
 *   Eviction is LRU *within* the definition: a slider-heavy definition churns
 *   only its own entries, not everyone else's.
 * - **Version keying means no invalidation.** Publishing mints a new
 *   `versionId` → fresh keyspace; rollback re-hits old entries; there's
 *   nothing to invalidate.
 */

/** The parts that address a cached solve. All four are folded into the stored key. */
export interface SolveCacheKey {
	/**
	 * Owning org (defense-in-depth against cross-tenant reads). Always a real
	 * org, never null — the app only builds a `SolveCacheKey` for org-scoped
	 * live-channel solves; remote-URL solves (no org) never reach this path.
	 */
	orgId: string;
	/** The definition guid — the quota scope. */
	definitionId: string;
	/** The immutable version id. */
	versionId: string;
	/** SHA-256 hex hash of the transformed input tree + solve-affecting config subset. */
	inputKey: string;
}

/** Options for a write; carries the per-definition quota so the backend stays stateless. */
export interface SolveCacheSetOptions {
	/**
	 * Max cached entries this definition may retain (`solveCacheLimit` on the
	 * definition record). Always `>= 1` — callers must not call `set` when the
	 * resolved quota is `0` (caching off).
	 */
	maxEntriesForDefinition: number;
}

/**
 * Durable solve-result cache — the seam a shared backend mounts on.
 *
 * No implementation ships today: the app runs on `adapter-node`, one
 * long-lived process, where in-process caching already works. Run N instances
 * behind a proxy and the in-process hit rate divides by N — that's when Redis
 * mounts here.
 *
 * Implementations must not throw — both methods sit on the hot path of every
 * live solve. A backend failure resolves as a miss (`get`) or a silent drop
 * (`set`); it never becomes a request error.
 */
export interface ISolveResultCache {
	/**
	 * Look up a cached envelope. Resolves the opaque bytes on a hit, or `null` on
	 * a miss (including any backend error). Bumps the entry's recency.
	 */
	get(ctx: RequestContext, key: SolveCacheKey): Promise<Uint8Array | null>;
	/**
	 * Store an envelope, evicting LRU-within-definition down to
	 * `opts.maxEntriesForDefinition`. Best-effort: silently drops on any failure.
	 */
	set(
		ctx: RequestContext,
		key: SolveCacheKey,
		bytes: Uint8Array,
		opts: SolveCacheSetOptions
	): Promise<void>;
}

/**
 * Default `ISolveResultCache` — never stores, always misses. The only
 * implementation that ships today; a shared backend replaces it when horizontal
 * scaling makes in-process caching insufficient.
 */
export class NoopSolveResultCache implements ISolveResultCache {
	async get(_ctx: RequestContext, _key: SolveCacheKey): Promise<Uint8Array | null> {
		return null;
	}
	async set(
		_ctx: RequestContext,
		_key: SolveCacheKey,
		_bytes: Uint8Array,
		_opts: SolveCacheSetOptions
	): Promise<void> {}
}
