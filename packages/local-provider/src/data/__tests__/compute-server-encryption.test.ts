import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SYSTEM_CONTEXT, type PlatformComputeServer } from '@selvajs/platform';
import { LocalComputeServerStore } from '../LocalComputeServerStore.js';

const TEST_SECRET_KEY = Buffer.alloc(32, 0x42);
const OTHER_KEY = Buffer.alloc(32, 0x99);

function makePlatformServer(
	overrides: Partial<Omit<PlatformComputeServer, 'scope'>> = {}
): PlatformComputeServer {
	return {
		id: overrides.id ?? 'a1',
		scope: 'platform',
		sharedWith: overrides.sharedWith ?? 'all',
		label: overrides.label ?? 'Test',
		serverUrl: overrides.serverUrl ?? 'http://localhost:5000',
		apiKey: overrides.apiKey,
		timeoutMs: overrides.timeoutMs,
		retryCount: overrides.retryCount
	};
}

describe('LocalComputeServerStore — apiKey encryption at rest', () => {
	let tempDir: string;
	let configPath: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-compute-enc-'));
		configPath = path.join(tempDir, 'compute.config.json');
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it('round-trips apiKey plaintext through the store', async () => {
		const store = new LocalComputeServerStore(configPath, TEST_SECRET_KEY);
		await store.savePlatformServers(
			SYSTEM_CONTEXT,
			[makePlatformServer({ apiKey: 'super-secret-value' })],
			'a1'
		);

		const got = await store.getConfig(SYSTEM_CONTEXT);
		expect(got.servers[0].apiKey).toBe('super-secret-value');
	});

	it('does not write the plaintext apiKey to disk', async () => {
		const store = new LocalComputeServerStore(configPath, TEST_SECRET_KEY);
		const plaintext = 'plaintext-must-not-appear-on-disk';
		await store.savePlatformServers(
			SYSTEM_CONTEXT,
			[makePlatformServer({ apiKey: plaintext })],
			'a1'
		);

		const onDisk = await fs.readFile(configPath, 'utf-8');
		expect(onDisk).not.toContain(plaintext);
		expect(onDisk).toContain('enc:v1:');
	});

	it('decryption with the wrong key throws', async () => {
		const writer = new LocalComputeServerStore(configPath, TEST_SECRET_KEY);
		await writer.savePlatformServers(
			SYSTEM_CONTEXT,
			[makePlatformServer({ apiKey: 'value' })],
			'a1'
		);

		const reader = new LocalComputeServerStore(configPath, OTHER_KEY);
		await expect(reader.getConfig(SYSTEM_CONTEXT)).rejects.toThrow();
	});

	it('refuses to read a legacy plaintext apiKey from disk', async () => {
		// Simulate a hand-edited or legacy file with a plaintext apiKey.
		await fs.mkdir(path.dirname(configPath), { recursive: true });
		await fs.writeFile(
			configPath,
			JSON.stringify({
				servers: [
					{
						id: 'a1',
						scope: 'platform',
						sharedWith: 'all',
						label: 'Legacy',
						serverUrl: 'http://localhost:5000',
						apiKey: 'plaintext-leftover'
					}
				]
			}),
			'utf-8'
		);

		const store = new LocalComputeServerStore(configPath, TEST_SECRET_KEY);
		await expect(store.getConfig(SYSTEM_CONTEXT)).rejects.toThrow(/unencrypted apiKey/);
	});

	it('preserves servers with no apiKey', async () => {
		const store = new LocalComputeServerStore(configPath, TEST_SECRET_KEY);
		await store.savePlatformServers(
			SYSTEM_CONTEXT,
			[makePlatformServer({ label: 'No Key' })],
			'a1'
		);

		const got = await store.getConfig(SYSTEM_CONTEXT);
		expect(got.servers[0].apiKey).toBeUndefined();
	});
});
