/**
 * Durable L2 cache-key derivation (H2 / R8 / R13).
 *
 * The in-process L1 cache keys on a 32-bit FNV hash — fine for a 20-entry Map,
 * unsafe for a durable, cross-user cache where a collision serves user A's
 * geometry to user B (CONTEXT.md L92–97 records exactly this bug shipping once).
 * So the L2 key is a wide SHA-256 hash, and the entry stores the canonical
 * preimage so a hit can compare it byte-for-byte (defense-in-depth).
 *
 * What goes into the key:
 *   - The **transformed** input tree (R13) — the exact tree handed to the
 *     scheduler, canonicalized with the package's exported `stableStringify` so
 *     the L2 key parity-matches the L1 canonicalization path.
 *   - A **config subset** (R8): everything OTHER than definition+inputs that
 *     changes a solve's result — model units, tolerances, `dataversion`, the
 *     compute contract version, and (when known) the Rhino server identity. A
 *     durable key of `(versionId, inputHash)` alone would collide across
 *     differing server configs or Rhino versions.
 *
 * `versionId`, `definitionId`, and `orgId` are NOT hashed in here — they're
 * separate parts of the {@link SolveCacheKey} tuple so the backend can scope its
 * keyspace (per-definition quota, per-org isolation) without unpacking the hash.
 */

import { createHash } from 'node:crypto';
import { stableStringify } from '@selvajs/compute';
import { COMPUTE_CONTRACT_VERSION } from './solve-pipeline.js';

/**
 * Solve-affecting configuration folded into the key alongside the input tree.
 * Every field here is something that, if it changed, would legitimately change
 * the solve output for the SAME definition + inputs. Assemble it from the app's
 * resolved solve config; unset fields are simply absent from the canonical form.
 */
export interface SolveCacheConfigSubset {
	/** Rhino model unit system, if the app pins one (else the definition/server default). */
	modelUnits?: string;
	/** Absolute tolerance, if pinned. */
	absoluteTolerance?: number;
	/** Angle tolerance, if pinned. */
	angleTolerance?: number;
	/** Grasshopper `dataversion` / data-tree schema version, if pinned. */
	dataVersion?: number | string;
	/**
	 * Compute-server identity (id or URL). Folds in because two servers can run
	 * different Rhino/plugin versions that yield different geometry for the same
	 * inputs. Optional — omit for a single-pool deployment where it's constant.
	 */
	computeServerId?: string;
}

/** The canonical preimage + its SHA-256 digest. Store both in the L2 entry header. */
export interface SolveCacheInputKey {
	/** The canonical string that was hashed (for hit-time byte comparison). */
	canonical: string;
	/** SHA-256 hex of {@link canonical} — the `inputKey` part of the storage key. */
	hash: string;
}

/**
 * Derive the durable `inputKey` from the transformed input tree and the solve
 * config subset. Deterministic and stable across processes/instances: the same
 * tree + config always produce the same hash, which is what lets a shared cache
 * hit across app instances.
 *
 * @param transformedTree the tree AFTER `transformInputParameter`/`TreeBuilder`
 *   (R13) — the exact object handed to `scheduler.solve`.
 * @param config solve-affecting config (R8); `COMPUTE_CONTRACT_VERSION` is folded
 *   in automatically so a wire-contract bump invalidates old entries for free.
 */
export function deriveSolveCacheInputKey(
	transformedTree: unknown,
	config: SolveCacheConfigSubset
): SolveCacheInputKey {
	// stableStringify sorts keys deterministically — same content, same string,
	// regardless of property insertion order. Tag each part so a value can't shift
	// across the tree/config boundary and collide (e.g. tree "]" meeting config "[").
	const canonical = stableStringify({
		v: COMPUTE_CONTRACT_VERSION,
		tree: transformedTree,
		config
	});
	const hash = createHash('sha256').update(canonical).digest('hex');
	return { canonical, hash };
}
