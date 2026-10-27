import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { VisualizationError } from '../../../shared/index.js';
import { parseBinaryMeshBatch } from '../binary-parser';

// The decoder's contract: a corrupt, truncated or unsupported blob throws
// VisualizationError. Anything else (a RangeError from a DataView read past the
// end, a TypeError, a typed-array allocation the header asked for) escapes the
// viewer's error handling and reaches the user as a crash.

const FIXTURES = fileURLToPath(new URL('../../../../../schemas/fixtures/', import.meta.url));

function blobsIn(dir: string): Uint8Array[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return blobsIn(path);
		return /\.(slva|slvz|slvm)$/.test(name) ? [new Uint8Array(readFileSync(path))] : [];
	});
}

const golden = [...blobsIn(join(FIXTURES, 'slva')), ...blobsIn(join(FIXTURES, 'slvm3'))];

/** Undefined when the blob decodes; the thrown value when it doesn't. */
function decode(bytes: Uint8Array): unknown {
	try {
		const parsed = parseBinaryMeshBatch(bytes);
		const vertexCount = parsed.vertices.length / 3;
		for (const i of parsed.indices) {
			if (i >= vertexCount) return new Error(`index ${i} past ${vertexCount} vertices`);
		}
		return undefined;
	} catch (err) {
		return err;
	}
}

function expectContract(bytes: Uint8Array): void {
	const thrown = decode(bytes);
	if (thrown !== undefined && !(thrown instanceof VisualizationError)) {
		throw new Error(`Escaped as ${(thrown as Error)?.name}: ${(thrown as Error)?.message}`);
	}
}

// FUZZ_RUNS=20000 for a deep run; the default keeps CI fast.
const RUNS = { numRuns: Number(process.env.FUZZ_RUNS ?? 300) };

describe('parseBinaryMeshBatch under corrupt input', () => {
	it('has golden blobs to mutate', () => {
		expect(golden.length).toBeGreaterThan(5);
	});

	it('throws only VisualizationError on arbitrary bytes', () => {
		fc.assert(fc.property(fc.uint8Array({ maxLength: 512 }), expectContract), RUNS);
	});

	it('throws only VisualizationError on a truncated golden blob', () => {
		fc.assert(
			fc.property(
				fc.nat(golden.length - 1),
				fc.double({ min: 0, max: 1, noNaN: true }),
				(g, at) => {
					const blob = golden[g];
					expectContract(blob.slice(0, Math.floor(blob.length * at)));
				}
			),
			RUNS
		);
	});

	it('throws only VisualizationError when golden bytes are overwritten', () => {
		fc.assert(
			fc.property(
				fc.nat(golden.length - 1),
				fc.array(fc.tuple(fc.nat(), fc.integer({ min: 0, max: 255 })), {
					minLength: 1,
					maxLength: 8
				}),
				// Half the edits land in the first 64 bytes, where the counts and flags live.
				fc.boolean(),
				(g, edits, headerOnly) => {
					const blob = golden[g].slice();
					const span = headerOnly ? Math.min(64, blob.length) : blob.length;
					for (const [pos, value] of edits) blob[pos % span] = value;
					expectContract(blob);
				}
			),
			RUNS
		);
	});
});
