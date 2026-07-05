/**
 * §3a: `user-data.json` is accessed through three views (data provider's
 * ensureUser/deleteUser, the permission store, the profile store). Each now
 * reads/writes through a load-once write-through cache, so `LocalDataProvider`
 * MUST inject ONE shared `LocalUserDataStore` into all three — otherwise a write
 * via one view would be invisible to another's cache.
 *
 * These tests pin that coherence end-to-end through the assembled provider.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import { LocalDataProvider } from '../LocalDataProvider.js';

let dir: string;
let env: Record<string, string>;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-userdata-'));
	// 32-byte key so LocalComputeServerStore.fromEnv (via the provider) is happy.
	env = { DATA_PATH: dir, SELVA_AT_REST_KEY: 'a'.repeat(64) };
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

describe('LocalDataProvider — shared user-data cache (§3a)', () => {
	it('a permission write is visible to the profile store (same cache)', async () => {
		const provider = LocalDataProvider.fromEnv(env);
		const userId = 'user-1';
		await provider.ensureUser(SYSTEM_CONTEXT, userId);

		// Write through the permission store...
		await provider.permissions.set(SYSTEM_CONTEXT, userId, ['instance_admin']);

		// ...read back through BOTH the permission store and the profile store.
		expect(await provider.permissions.getFor(SYSTEM_CONTEXT, userId)).toEqual(['instance_admin']);
		const profile = await provider.userProfile.getProfile(SYSTEM_CONTEXT, userId);
		expect(profile).not.toBeNull();
	});

	it('a profile write (displayName) is visible to a subsequent profile read', async () => {
		const provider = LocalDataProvider.fromEnv(env);
		const userId = 'user-2';
		await provider.ensureUser(SYSTEM_CONTEXT, userId);

		await provider.userProfile.updateProfile(SYSTEM_CONTEXT, userId, { displayName: 'Ada' });
		const profile = await provider.userProfile.getProfile(SYSTEM_CONTEXT, userId);
		expect(profile?.displayName).toBe('Ada');
	});

	it('ensureUser + permission write persists across a fresh provider (write-through to disk)', async () => {
		const p1 = LocalDataProvider.fromEnv(env);
		const userId = 'user-3';
		await p1.ensureUser(SYSTEM_CONTEXT, userId);
		await p1.permissions.set(SYSTEM_CONTEXT, userId, ['manage_compute']);

		// A brand-new provider (cold cache) must read the persisted state from disk.
		const p2 = LocalDataProvider.fromEnv(env);
		expect(await p2.permissions.getFor(SYSTEM_CONTEXT, userId)).toEqual(['manage_compute']);
	});
});
