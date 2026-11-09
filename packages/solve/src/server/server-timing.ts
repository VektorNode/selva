import type { ServerTiming } from '@selvajs/compute/core';

/** A pre-solve prep sub-phase: `[label, ms]`, surfaced as a `p_*` Server-Timing entry. */
export type PrepMark = [string, number];

export interface CacheVerdict {
	fromCache: boolean;
	definitionReuploaded?: boolean;
}

/**
 * skipped = scheduler never materialized bytes (pointer-known solve, the whole point of this
 * path); hit = warm byte cache; miss = fell through to storage.
 */
export type DefBytesVerdict = 'skipped' | 'hit' | 'miss';

interface ServerTimingParts {
	defLoadMs: number;
	treeBuildMs: number;
	solveMs: number;
	serializeMs: number;
	gzipMs: number;
	serverTotalMs: number;
	rhino: ServerTiming | null;
	settle: CacheVerdict;
	/** Absent for raw-bytes solves. */
	defBytes?: DefBytesVerdict;
	prepMarks: PrepMark[];
}

/**
 * False for a header carrying only the proxy's `affinity`, from a child that sends no timing:
 * read as zeros, it would put the whole solve on `compute_link`.
 */
export function reportsTiming(rhino: ServerTiming): boolean {
	return (
		rhino.cacheHit === true ||
		rhino.decode !== undefined ||
		rhino.solve !== undefined ||
		rhino.encode !== undefined
	);
}

/**
 * `total` is the server's headers-to-out wall time, so browser `ttfb − total`
 * ≈ network+send latency. When the compute server reports its own timing
 * (VektorNode fork), `rhino_*` is time on the compute server and `compute_link`
 * is everything between it (network + queue wait). `rhino_cache` is 1 when the
 * compute server answered from its own result cache.
 */
export function buildServerTiming(parts: ServerTimingParts): string {
	let header =
		`load;dur=${parts.defLoadMs.toFixed(1)}, ` +
		`tree;dur=${parts.treeBuildMs.toFixed(1)}, ` +
		`solve;dur=${parts.solveMs.toFixed(1)}, ` +
		`serialize;dur=${parts.serializeMs.toFixed(1)}, ` +
		`gzip;dur=${parts.gzipMs.toFixed(1)}, ` +
		`total;dur=${parts.serverTotalMs.toFixed(1)}`;

	const rhino = parts.rhino;
	if (rhino && reportsTiming(rhino)) {
		const decode = rhino.decode ?? 0;
		const solve = rhino.solve ?? 0;
		const encode = rhino.encode ?? 0;
		const computeLinkMs = Math.max(0, parts.solveMs - decode - solve - encode);
		header +=
			`, rhino_decode;dur=${decode.toFixed(1)}` +
			`, rhino_solve;dur=${solve.toFixed(1)}` +
			`, rhino_encode;dur=${encode.toFixed(1)}` +
			`, compute_link;dur=${computeLinkMs.toFixed(1)}` +
			`, rhino_cache;dur=${rhino.cacheHit ? 1 : 0}`;
		if (rhino.gh !== undefined) header += `, rhino_gh;dur=${rhino.gh.toFixed(1)}`;
		if (rhino.recomputed) {
			header += `, rhino_recomputed;desc="${rhino.recomputed.ran}/${rhino.recomputed.total}"`;
		}
	}
	if (rhino?.affinity) header += `, rhino_affinity;desc=${rhino.affinity}`;

	for (const [label, ms] of parts.prepMarks) {
		header += `, p_${label};dur=${ms.toFixed(1)}`;
	}

	const settle = parts.settle;
	header += `, selva_cache;dur=${settle.fromCache ? 1 : 0}`;
	if (settle.definitionReuploaded !== undefined) {
		header += `, def_reupload;dur=${settle.definitionReuploaded ? 1 : 0}`;
	}

	if (parts.defBytes) header += `, def_bytes;desc=${parts.defBytes}`;

	return header;
}
