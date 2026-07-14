/**
 * Tests for the module-level texture cache: the clear/in-flight race (a load resolving after
 * clearTextureCache must not repopulate the cache and must dispose the orphaned texture), the
 * LRU bound, and data-URI key handling.
 *
 * THREE.TextureLoader is stubbed at the prototype so tests control exactly when each load
 * resolves; `document` is stubbed because the module skips loading entirely without a DOM.
 */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { applyTextureMap, clearTextureCache, TEXTURE_CACHE_MAX_ENTRIES } from '../texture-cache.js';

type OnLoad = (texture: THREE.Texture) => void;
type OnError = (error: unknown) => void;

interface PendingLoad {
	url: string;
	onLoad: OnLoad;
	onError: OnError;
}

let pendingLoads: PendingLoad[];
let loadSpy: MockInstance<THREE.TextureLoader['load']>;

/** Lets the promise chain inside applyTextureMap settle. */
const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const makeMaterial = () => new THREE.MeshPhysicalMaterial();

beforeEach(() => {
	// The module is DOM-gated; a minimal stub is enough since the loader itself is mocked.
	vi.stubGlobal('document', {});

	pendingLoads = [];
	loadSpy = vi
		.spyOn(THREE.TextureLoader.prototype, 'load')
		.mockImplementation(function (url, onLoad, _onProgress, onError) {
			pendingLoads.push({
				url: url as string,
				onLoad: onLoad as OnLoad,
				onError: onError as OnError
			});
			return new THREE.Texture();
		});

	// Isolate module-level state between tests.
	clearTextureCache();
});

afterEach(() => {
	clearTextureCache();
	loadSpy.mockRestore();
	vi.unstubAllGlobals();
});

describe('applyTextureMap caching', () => {
	it('loads a URL once and serves subsequent requests synchronously from the cache', async () => {
		const first = makeMaterial();
		applyTextureMap(first, 'http://localhost/assets/aaa');
		expect(pendingLoads).toHaveLength(1);

		const texture = new THREE.Texture();
		pendingLoads[0]!.onLoad(texture);
		await flushMicrotasks();
		expect(first.map).toBe(texture);

		// Cached: assigned synchronously, no second load.
		const second = makeMaterial();
		applyTextureMap(second, 'http://localhost/assets/aaa');
		expect(second.map).toBe(texture);
		expect(loadSpy).toHaveBeenCalledTimes(1);
	});

	it('shares one in-flight load between materials requesting the same URL', async () => {
		const a = makeMaterial();
		const b = makeMaterial();
		applyTextureMap(a, 'http://localhost/assets/shared');
		applyTextureMap(b, 'http://localhost/assets/shared');
		expect(loadSpy).toHaveBeenCalledTimes(1);

		const texture = new THREE.Texture();
		pendingLoads[0]!.onLoad(texture);
		await flushMicrotasks();

		expect(a.map).toBe(texture);
		expect(b.map).toBe(texture);
	});

	it('leaves the material untextured and warns on load failure', async () => {
		const material = makeMaterial();
		applyTextureMap(material, 'http://localhost/assets/broken');
		pendingLoads[0]!.onError(new Error('404'));
		await flushMicrotasks();

		expect(material.map).toBeNull();

		// A retry after failure starts a fresh load (the failed one left no cache entry).
		applyTextureMap(makeMaterial(), 'http://localhost/assets/broken');
		expect(loadSpy).toHaveBeenCalledTimes(2);
	});

	it('caches oversized data-URI references without retaining them as literal keys', async () => {
		// A data URI far past the key-size cap must still hit the cache on re-request.
		const dataUri = `data:image/png;base64,${'A'.repeat(10_000)}`;

		const first = makeMaterial();
		applyTextureMap(first, dataUri);
		expect(pendingLoads).toHaveLength(1);
		// The full URI is still what gets fetched — only the cache key is hashed.
		expect(pendingLoads[0]!.url).toBe(dataUri);

		const texture = new THREE.Texture();
		pendingLoads[0]!.onLoad(texture);
		await flushMicrotasks();

		const second = makeMaterial();
		applyTextureMap(second, dataUri);
		expect(second.map).toBe(texture);
		expect(loadSpy).toHaveBeenCalledTimes(1);
	});
});

describe('clearTextureCache vs in-flight loads (issue 16)', () => {
	it('does not repopulate the cache when a load resolves after a clear, and disposes the orphan', async () => {
		const material = makeMaterial();
		applyTextureMap(material, 'http://localhost/assets/racy');
		expect(pendingLoads).toHaveLength(1);

		clearTextureCache();

		const orphan = new THREE.Texture();
		const disposeSpy = vi.spyOn(orphan, 'dispose');
		pendingLoads[0]!.onLoad(orphan);
		await flushMicrotasks();

		// The orphaned texture is disposed, never assigned, and never warned about.
		expect(disposeSpy).toHaveBeenCalledTimes(1);
		expect(material.map).toBeNull();

		// The cache was NOT repopulated: a fresh request starts a fresh load instead of a sync hit.
		const later = makeMaterial();
		applyTextureMap(later, 'http://localhost/assets/racy');
		expect(later.map).toBeNull();
		expect(loadSpy).toHaveBeenCalledTimes(2);
	});

	it('keeps a newer in-flight load intact when a pre-clear load settles after it started', async () => {
		// Old load starts, cache cleared, new load for the same URL starts, then the OLD one
		// resolves: the stale resolution must not evict/duplicate the new in-flight entry.
		applyTextureMap(makeMaterial(), 'http://localhost/assets/overlap');
		clearTextureCache();

		const newMaterial = makeMaterial();
		applyTextureMap(newMaterial, 'http://localhost/assets/overlap');
		expect(pendingLoads).toHaveLength(2);

		const stale = new THREE.Texture();
		pendingLoads[0]!.onLoad(stale); // old load resolves after the clear
		const fresh = new THREE.Texture();
		pendingLoads[1]!.onLoad(fresh); // new load resolves normally
		await flushMicrotasks();

		expect(newMaterial.map).toBe(fresh);

		// The fresh texture is cached; a third request is a sync hit (still only two loads).
		const third = makeMaterial();
		applyTextureMap(third, 'http://localhost/assets/overlap');
		expect(third.map).toBe(fresh);
		expect(loadSpy).toHaveBeenCalledTimes(2);
	});

	it('disposes cached textures on clear', async () => {
		applyTextureMap(makeMaterial(), 'http://localhost/assets/cached');
		const texture = new THREE.Texture();
		const disposeSpy = vi.spyOn(texture, 'dispose');
		pendingLoads[0]!.onLoad(texture);
		await flushMicrotasks();

		clearTextureCache();
		expect(disposeSpy).toHaveBeenCalledTimes(1);
	});
});

describe('LRU bound (issue 17)', () => {
	it('evicts and disposes the least-recently-used texture past the cap', async () => {
		const textures: THREE.Texture[] = [];
		for (let i = 0; i <= TEXTURE_CACHE_MAX_ENTRIES; i++) {
			applyTextureMap(makeMaterial(), `http://localhost/assets/${i}`);
			const texture = new THREE.Texture();
			textures.push(texture);
			pendingLoads[i]!.onLoad(texture);
		}
		await flushMicrotasks();

		// The first-inserted texture fell off the LRU and was disposed...
		const firstDispose = vi.spyOn(textures[0]!, 'dispose');
		applyTextureMap(makeMaterial(), 'http://localhost/assets/0');
		// ...so re-requesting it starts a new load rather than a sync hit.
		expect(loadSpy).toHaveBeenCalledTimes(TEXTURE_CACHE_MAX_ENTRIES + 2);
		expect(firstDispose).not.toHaveBeenCalled(); // disposed during eviction, before the spy

		// The most recent entry is still cached.
		const recent = makeMaterial();
		applyTextureMap(recent, `http://localhost/assets/${TEXTURE_CACHE_MAX_ENTRIES}`);
		expect(recent.map).toBe(textures[TEXTURE_CACHE_MAX_ENTRIES]);
	});

	it('refreshes recency on cache hits so hot textures survive eviction pressure', async () => {
		// Fill to the cap.
		const textures: THREE.Texture[] = [];
		for (let i = 0; i < TEXTURE_CACHE_MAX_ENTRIES; i++) {
			applyTextureMap(makeMaterial(), `http://localhost/assets/${i}`);
			const texture = new THREE.Texture();
			textures.push(texture);
			pendingLoads[i]!.onLoad(texture);
		}
		await flushMicrotasks();

		// Touch the oldest entry (index 0), then insert one more to force an eviction.
		applyTextureMap(makeMaterial(), 'http://localhost/assets/0');
		applyTextureMap(makeMaterial(), 'http://localhost/assets/one-more');
		pendingLoads[TEXTURE_CACHE_MAX_ENTRIES]!.onLoad(new THREE.Texture());
		await flushMicrotasks();

		// Index 0 was refreshed, so index 1 was the LRU victim: 0 is still a sync hit...
		const hot = makeMaterial();
		applyTextureMap(hot, 'http://localhost/assets/0');
		expect(hot.map).toBe(textures[0]);
		// ...while 1 needs a fresh load.
		const loadsBefore = loadSpy.mock.calls.length;
		applyTextureMap(makeMaterial(), 'http://localhost/assets/1');
		expect(loadSpy.mock.calls.length).toBe(loadsBefore + 1);
	});
});
