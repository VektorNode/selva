import type { RequestContext } from '../context.js';

/**
 * Durable L2 solve-result cache (H1). The scheduler's in-process `Map` is L1 —
 * 20 entries, 5-min TTL, per app instance. This is the shared, longer-lived
 * layer keyed on `(orgId, definitionId, versionId, inputKey)` where `inputKey`
 * is a wide (SHA-256) hash of the transformed input tree plus the solve-affecting
 * config subset (H2/R8). A hit skips compute entirely.
 *
 * Design contract (decided 2026-07-11, see CACHING.md H1):
 *
 * - **Async from day one.** The memory backend returns promises too, so no call
 *   site changes shape when a network store (Redis) arrives later.
 * - **Entries are opaque bytes** — the pre-gzipped response envelope (R6) plus a
 *   small metadata header. The backend never inspects them; memory stores the
 *   same buffer Redis would, so a hit stays near-CPU-free in either backend and
 *   there is no serialization drift between impls.
 * - **Best-effort.** `get` may miss at any time (restart, eviction, network
 *   blip); `set` may silently drop. Correctness NEVER depends on cache presence —
 *   this is what makes backends interchangeable and what makes the
 *   no-TTL/versionId keying safe under any eviction policy.
 * - **Per-definition quota, passed at write time.** `set` carries
 *   `maxEntriesForDefinition` so the backend holds no policy, only data. Eviction
 *   is LRU *within* the definition: a slider-heavy definition churns only its own
 *   entries, not everyone else's.
 * - **Version keying = no invalidation.** Publishing mints a new `versionId` →
 *   fresh keyspace; rollback re-hits old entries; there is nothing to invalidate.
 */

/** The parts that address a cached solve. All four are folded into the stored key. */
export interface SolveCacheKey {
	/**
	 * Owning org (defense-in-depth against cross-tenant reads). Null for
	 * remote-URL solves that have no org — those are not cached (the app passes
	 * the cache hook only for org-scoped live-channel solves).
	 */
	orgId: string;
	/** The definition guid — the quota scope. */
	definitionId: string;
	/** The immutable version id — no TTL needed, so entries never go stale. */
	versionId: string;
	/**
	 * Wide hash of the transformed input tree + solve-affecting config subset
	 * (SHA-256 hex; see the pipeline's key builder). This is the only part that
	 * varies per solve of a given version.
	 */
	inputKey: string;
}

/** Options for a write; carries the per-definition quota so the backend stays stateless. */
export interface SolveCacheSetOptions {
	/**
	 * Max cached entries this definition may retain. The backend evicts
	 * LRU-within-definition down to this count on write. A definition's quota is
	 * `solveCacheLimit` (absent → the global default); the app never calls `set`
	 * when the resolved quota is `0` (caching off), so this is always `>= 1`.
	 */
	maxEntriesForDefinition: number;
}

/**
 * Durable solve-result cache. The solve pipeline talks only to this interface;
 * the backend (memory today, Redis later) is a config change, not a redesign.
 *
 * Implementations MUST NOT throw — both methods are best-effort on the hot path
 * of every live solve. A backend failure resolves as a miss (`get`) or a silent
 * drop (`set`); it never becomes a request error.
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
 * Default `ISolveResultCache` — never stores, always misses. Used when
 * `SOLVE_CACHE_PROVIDER=off` (or unset). Swap in the memory backend
 * (`@selvajs/server`) or a shared store to enable the durable L2.
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
