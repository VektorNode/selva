/**
 * Tests for the durable L2 solve-cache building blocks (Phase 3):
 *   - the in-memory backend (per-definition count quota + global byte backstop),
 *   - the SHA-256 key derivation (org isolation, version keyspace, config fold),
 *   - the envelope codec (round-trip, corruption → miss),
 *   - the in-process single-flight (coalescing, release-on-settle).
 *
 * `@selvajs/compute`'s `stableStringify` is the only external dependency of the
 * key module; it's a real export (deterministic sorted-key JSON), so these run
 * without mocking.
 */

import { describe, it, expect } from 'vitest';
import { SYSTEM_CONTEXT, type SolveCacheKey } from '@selvajs/platform';
import { createMemorySolveResultCache } from '../memory-solve-cache.js';
import { deriveSolveCacheInputKey } from '../solve-cache-key.js';
import {
	encodeSolveCacheEntry,
	decodeSolveCacheEntry,
	gunzipEntryBody
} from '../solve-cache-envelope.js';
import { createSolveCacheSingleFlight } from '../solve-cache-single-flight.js';
import { gzipSync } from 'node:zlib';

const ctx = SYSTEM_CONTEXT;

function key(over: Partial<SolveCacheKey> = {}): SolveCacheKey {
	return {
		orgId: over.orgId ?? 'org-1',
		definitionId: over.definitionId ?? 'def-1',
		versionId: over.versionId ?? 'v-1',
		inputKey: over.inputKey ?? 'in-1'
	};
}

const bytes = (n: number) => new Uint8Array(n).fill(1);

// ============================================================================
// Memory backend
// ============================================================================

describe('createMemorySolveResultCache — round-trip + quota', () => {
	it('stores then serves the exact bytes on a hit, and bumps counters', async () => {
		const cache = createMemorySolveResultCache(0);
		const payload = new Uint8Array([9, 8, 7]);
		await cache.set(ctx, key(), payload, { maxEntriesForDefinition: 5 });
		const got = await cache.get(ctx, key());
		expect(got).toEqual(payload);
		expect(await cache.get(ctx, key({ inputKey: 'absent' }))).toBeNull();
		const stats = cache.stats();
		expect(stats.hits).toBe(1);
		expect(stats.misses).toBe(1);
		expect(stats.writes).toBe(1);
		expect(stats.entries).toBe(1);
	});

	it('quota 0 (caching off for the definition) stores nothing', async () => {
		const cache = createMemorySolveResultCache(0);
		await cache.set(ctx, key(), bytes(10), { maxEntriesForDefinition: 0 });
		expect(await cache.get(ctx, key())).toBeNull();
		expect(cache.stats().entries).toBe(0);
	});

	it('evicts LRU WITHIN a definition down to its quota, not across definitions', async () => {
		const cache = createMemorySolveResultCache(0);
		// def-A gets a quota of 2; write 3 distinct inputs → oldest evicted.
		await cache.set(ctx, key({ definitionId: 'A', inputKey: 'a1' }), bytes(1), {
			maxEntriesForDefinition: 2
		});
		await cache.set(ctx, key({ definitionId: 'A', inputKey: 'a2' }), bytes(1), {
			maxEntriesForDefinition: 2
		});
		// def-B writes an entry in between — must NOT be evicted by def-A's churn.
		await cache.set(ctx, key({ definitionId: 'B', inputKey: 'b1' }), bytes(1), {
			maxEntriesForDefinition: 2
		});
		await cache.set(ctx, key({ definitionId: 'A', inputKey: 'a3' }), bytes(1), {
			maxEntriesForDefinition: 2
		});

		expect(await cache.get(ctx, key({ definitionId: 'A', inputKey: 'a1' }))).toBeNull(); // evicted
		expect(await cache.get(ctx, key({ definitionId: 'A', inputKey: 'a2' }))).not.toBeNull();
		expect(await cache.get(ctx, key({ definitionId: 'A', inputKey: 'a3' }))).not.toBeNull();
		expect(await cache.get(ctx, key({ definitionId: 'B', inputKey: 'b1' }))).not.toBeNull(); // untouched
		expect(cache.stats().quotaEvictions).toBe(1);
	});

	it('LRU-within-definition respects recency: a re-read entry is not the one evicted', async () => {
		const cache = createMemorySolveResultCache(0);
		await cache.set(ctx, key({ inputKey: 'x' }), bytes(1), { maxEntriesForDefinition: 2 });
		await cache.set(ctx, key({ inputKey: 'y' }), bytes(1), { maxEntriesForDefinition: 2 });
		// Touch x so y becomes the LRU.
		await cache.get(ctx, key({ inputKey: 'x' }));
		await cache.set(ctx, key({ inputKey: 'z' }), bytes(1), { maxEntriesForDefinition: 2 });
		expect(await cache.get(ctx, key({ inputKey: 'y' }))).toBeNull(); // y was LRU → evicted
		expect(await cache.get(ctx, key({ inputKey: 'x' }))).not.toBeNull();
	});

	it('the global byte backstop evicts across definitions regardless of counts', async () => {
		// 30-byte budget; three 20-byte entries in different definitions with generous
		// per-definition quotas → the backstop evicts the global LRU to fit.
		const cache = createMemorySolveResultCache(30);
		await cache.set(ctx, key({ definitionId: 'A', inputKey: 'a' }), bytes(20), {
			maxEntriesForDefinition: 100
		});
		await cache.set(ctx, key({ definitionId: 'B', inputKey: 'b' }), bytes(20), {
			maxEntriesForDefinition: 100
		});
		// A's entry is the global LRU and gets evicted to keep total <= 30.
		expect(await cache.get(ctx, key({ definitionId: 'A', inputKey: 'a' }))).toBeNull();
		expect(await cache.get(ctx, key({ definitionId: 'B', inputKey: 'b' }))).not.toBeNull();
		expect(cache.stats().byteEvictions).toBeGreaterThanOrEqual(1);
		expect(cache.stats().bytes).toBeLessThanOrEqual(30);
	});

	it('an entry larger than the whole byte backstop is served once but not retained', async () => {
		const cache = createMemorySolveResultCache(10);
		await cache.set(ctx, key(), bytes(50), { maxEntriesForDefinition: 100 });
		expect(await cache.get(ctx, key())).toBeNull();
		expect(cache.stats().bytes).toBe(0);
	});

	it('org id is part of the key: the same definition/version/input under two orgs is isolated', async () => {
		const cache = createMemorySolveResultCache(0);
		await cache.set(ctx, key({ orgId: 'org-A' }), new Uint8Array([1]), {
			maxEntriesForDefinition: 5
		});
		expect(await cache.get(ctx, key({ orgId: 'org-B' }))).toBeNull(); // no cross-tenant read
		expect(await cache.get(ctx, key({ orgId: 'org-A' }))).toEqual(new Uint8Array([1]));
	});

	it('replacing an existing key updates bytes in place without double-counting', async () => {
		const cache = createMemorySolveResultCache(0);
		await cache.set(ctx, key(), bytes(10), { maxEntriesForDefinition: 5 });
		await cache.set(ctx, key(), bytes(4), { maxEntriesForDefinition: 5 });
		expect(cache.stats().entries).toBe(1);
		expect(cache.stats().bytes).toBe(4);
	});

	it('a version bump is a fresh keyspace (old version entries do not collide)', async () => {
		const cache = createMemorySolveResultCache(0);
		await cache.set(ctx, key({ versionId: 'v-1' }), new Uint8Array([1]), {
			maxEntriesForDefinition: 5
		});
		// New version, same definition/input key → distinct entry, old one still there.
		expect(await cache.get(ctx, key({ versionId: 'v-2' }))).toBeNull();
		await cache.set(ctx, key({ versionId: 'v-2' }), new Uint8Array([2]), {
			maxEntriesForDefinition: 5
		});
		expect(await cache.get(ctx, key({ versionId: 'v-1' }))).toEqual(new Uint8Array([1]));
		expect(await cache.get(ctx, key({ versionId: 'v-2' }))).toEqual(new Uint8Array([2]));
	});
});

// ============================================================================
// Key derivation
// ============================================================================

describe('deriveSolveCacheInputKey', () => {
	const tree = { a: 1, b: [2, 3] };

	it('is deterministic for the same tree + config', () => {
		const k1 = deriveSolveCacheInputKey(tree, { computeServerId: 's1' });
		const k2 = deriveSolveCacheInputKey(tree, { computeServerId: 's1' });
		expect(k1.hash).toBe(k2.hash);
		expect(k1.hash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
	});

	it('differs when the tree differs', () => {
		const a = deriveSolveCacheInputKey({ a: 1 }, {});
		const b = deriveSolveCacheInputKey({ a: 2 }, {});
		expect(a.hash).not.toBe(b.hash);
	});

	it('folds the config subset in (R8): a different compute server → different key', () => {
		const a = deriveSolveCacheInputKey(tree, { computeServerId: 's1' });
		const b = deriveSolveCacheInputKey(tree, { computeServerId: 's2' });
		expect(a.hash).not.toBe(b.hash);
	});
});

// ============================================================================
// Envelope codec
// ============================================================================

describe('solve-cache envelope codec', () => {
	const header = { errorCount: 1, warningCount: 2, serializedBytes: 42, inputHash: 'abc' };

	it('round-trips header + gzipped body', () => {
		const body = new Uint8Array(gzipSync(Buffer.from('{"hello":"world"}')));
		const encoded = encodeSolveCacheEntry(header, body);
		const decoded = decodeSolveCacheEntry(encoded);
		expect(decoded).not.toBeNull();
		expect(decoded!.header).toEqual(header);
		expect(gunzipEntryBody(decoded!.gzippedBody)).toBe('{"hello":"world"}');
	});

	it('returns null for a truncated / malformed entry (→ treated as a miss)', () => {
		expect(decodeSolveCacheEntry(new Uint8Array([1, 2]))).toBeNull(); // too short for length prefix
		const encoded = encodeSolveCacheEntry(header, new Uint8Array([1, 2, 3]));
		expect(decodeSolveCacheEntry(encoded.slice(0, 6))).toBeNull(); // header claims more than present
	});

	it('returns null when the header JSON is missing required fields', () => {
		// Hand-craft an entry whose header is valid JSON but the wrong shape.
		const badHeader = Buffer.from(JSON.stringify({ nope: true }), 'utf8');
		const out = Buffer.allocUnsafe(4 + badHeader.byteLength);
		out.writeUInt32BE(badHeader.byteLength, 0);
		badHeader.copy(out, 4);
		expect(decodeSolveCacheEntry(new Uint8Array(out))).toBeNull();
	});
});

// ============================================================================
// Single-flight
// ============================================================================

describe('createSolveCacheSingleFlight', () => {
	it('coalesces concurrent identical calls into one execution', async () => {
		const sf = createSolveCacheSingleFlight();
		let runs = 0;
		let release!: (v: number) => void;
		const gate = new Promise<number>((r) => (release = r));
		const work = () => {
			runs += 1;
			return gate;
		};
		const p1 = sf.run('k', work);
		const p2 = sf.run('k', work);
		expect(sf.inFlight()).toBe(1);
		release(7);
		expect(await p1).toBe(7);
		expect(await p2).toBe(7); // shared result
		expect(runs).toBe(1); // executed once
	});

	it('runs distinct keys independently', async () => {
		const sf = createSolveCacheSingleFlight();
		let runs = 0;
		await Promise.all([sf.run('a', async () => void runs++), sf.run('b', async () => void runs++)]);
		expect(runs).toBe(2);
	});

	it('releases the key after settle so a later call runs fresh', async () => {
		const sf = createSolveCacheSingleFlight();
		let runs = 0;
		await sf.run('k', async () => void runs++);
		expect(sf.inFlight()).toBe(0);
		await sf.run('k', async () => void runs++);
		expect(runs).toBe(2);
	});

	it('a rejection is shared by concurrent waiters and still frees the key', async () => {
		const sf = createSolveCacheSingleFlight();
		const boom = () => Promise.reject(new Error('boom'));
		const p1 = sf.run('k', boom);
		const p2 = sf.run('k', boom);
		await expect(p1).rejects.toThrow('boom');
		await expect(p2).rejects.toThrow('boom');
		expect(sf.inFlight()).toBe(0);
	});
});
