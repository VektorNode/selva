import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import { LocalComputeServerStore } from '../LocalComputeServerStore.js';

const TEST_SECRET_KEY = Buffer.alloc(32, 0x42);
const OTHER_KEY = Buffer.alloc(32, 0x99);

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
		await store.saveConfig(SYSTEM_CONTEXT, {
			servers: [
				{
					id: 'a1',
					label: 'Test',
					serverUrl: 'http://localhost:5000',
					apiKey: 'super-secret-value'
				}
			]
		});

		const got = await store.getConfig(SYSTEM_CONTEXT);
		expect(got.servers[0].apiKey).toBe('super-secret-value');
	});

	it('does not write the plaintext apiKey to disk', async () => {
		const store = new LocalComputeServerStore(configPath, TEST_SECRET_KEY);
		const plaintext = 'plaintext-must-not-appear-on-disk';
		await store.saveConfig(SYSTEM_CONTEXT, {
			servers: [{ id: 'a1', label: 'Test', serverUrl: 'http://localhost:5000', apiKey: plaintext }]
		});

		const onDisk = await fs.readFile(configPath, 'utf-8');
		expect(onDisk).not.toContain(plaintext);
		expect(onDisk).toContain('enc:v1:');
	});

	it('decryption with the wrong key throws', async () => {
		const writer = new LocalComputeServerStore(configPath, TEST_SECRET_KEY);
		await writer.saveConfig(SYSTEM_CONTEXT, {
			servers: [{ id: 'a1', label: 'Test', serverUrl: 'http://localhost:5000', apiKey: 'value' }]
		});

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
		await store.saveConfig(SYSTEM_CONTEXT, {
			servers: [{ id: 'a1', label: 'No Key', serverUrl: 'http://localhost:5000' }]
		});

		const got = await store.getConfig(SYSTEM_CONTEXT);
		expect(got.servers[0].apiKey).toBeUndefined();
	});
});
