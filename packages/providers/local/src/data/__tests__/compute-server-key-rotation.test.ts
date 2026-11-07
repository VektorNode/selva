import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SYSTEM_CONTEXT, type PlatformComputeServer } from '@selvajs/platform';
import { LocalComputeServerStore } from '../LocalComputeServerStore.js';

// A rotated SELVA_AT_REST_KEY must not lose a stored Rhino.Compute key: the
// previous key still opens it, boot re-seals it, and only then can the
// previous key go.
describe('rotating SELVA_AT_REST_KEY', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'selva-rotate-'));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const oldKey = Buffer.alloc(32, 1);
	const newKey = Buffer.alloc(32, 2);
	const server: PlatformComputeServer = {
		id: 'srv-1',
		scope: 'platform',
		sharedWith: 'all',
		label: 'Main',
		serverUrl: 'http://localhost:5000',
		apiKey: 'the-compute-api-key'
	};

	it('keeps the API key readable through the rotation and after the previous key is dropped', async () => {
		const file = join(dir, 'compute.config.json');
		await new LocalComputeServerStore(file, oldKey).savePlatformServers(
			SYSTEM_CONTEXT,
			[server],
			'srv-1'
		);

		const rotated = new LocalComputeServerStore(file, newKey, undefined, oldKey);
		expect(await rotated.getServerApiKey(SYSTEM_CONTEXT, 'srv-1')).toBe('the-compute-api-key');
		expect((await rotated.verifySecrets()).onPreviousKey).toBe(1);

		expect(await rotated.reencryptSecrets()).toBe(1);
		expect((await rotated.verifySecrets()).onPreviousKey).toBe(0);

		const finished = new LocalComputeServerStore(file, newKey);
		expect(await finished.getServerApiKey(SYSTEM_CONTEXT, 'srv-1')).toBe('the-compute-api-key');
		expect((await finished.verifySecrets()).ok).toBe(true);
	});
});
