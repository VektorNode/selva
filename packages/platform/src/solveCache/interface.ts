import type { RequestContext } from '../context.js';

/**
 * Shared solve-result cache seam, keyed on `(orgId, definitionId, versionId,
 * inputKey)` where `inputKey` is a wide (SHA-256) hash of the transformed input
 * tree plus the solve-affecting config subset. A hit skips compute entirely.
 *
 * No backend ships today — see {@link ISolveResultCache} for why the interface
 * outlived the in-process implementation that used to sit behind it.
 *
 * Design contract (decided 2026-07-11):
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
	 * `solveCacheLimit` on the definition record; a caller must not call `set` when
	 * the resolved quota is `0` (caching off), so this is always `>= 1`.
	 */
	maxEntriesForDefinition: number;
}

/**
 * Durable solve-result cache — the seam a SHARED backend mounts on.
 *
 * There is deliberately no implementation today. The in-process one that used to
 * live behind this interface was redundant: it was a `Map` in the same heap as
 * the scheduler's own response cache, which is consulted first, so it could only
 * ever serve what that cache had already evicted. It was deleted; this interface
 * was not, because it is the piece that is correct for scaling.
 *
 * The reason to keep it: the app runs on `adapter-node`, one long-lived process,
 * so in-process caches work well for a single instance. Run N instances behind a
 * proxy and every in-process hit rate divides by N. When that day comes the answer
 * is Redis behind this interface — async from day one, opaque bytes, best-effort
 * by contract, so a network backend drops in without any call site changing shape.
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
