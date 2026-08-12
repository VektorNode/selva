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

		const got = await store.getConfig(SYSTEM_CONTEXT, { includeApiKeys: true });
		expect(got.servers[0].apiKey).toBe('super-secret-value');
	});

	it('omits apiKey unless includeApiKeys is set, but still reports hasApiKey', async () => {
		const store = new LocalComputeServerStore(configPath, TEST_SECRET_KEY);
		await store.savePlatformServers(
			SYSTEM_CONTEXT,
			[makePlatformServer({ apiKey: 'super-secret-value' })],
			'a1'
		);

		const got = await store.getConfig(SYSTEM_CONTEXT);
		expect(got.servers[0].apiKey).toBeUndefined();
		expect(got.servers[0].hasApiKey).toBe(true);
	});

	it('getServerApiKey returns one decrypted key, and undefined for an unknown id', async () => {
		const store = new LocalComputeServerStore(configPath, TEST_SECRET_KEY);
		await store.savePlatformServers(
			SYSTEM_CONTEXT,
			[makePlatformServer({ apiKey: 'super-secret-value' })],
			'a1'
		);

		expect(await store.getServerApiKey(SYSTEM_CONTEXT, 'a1')).toBe('super-secret-value');
		expect(await store.getServerApiKey(SYSTEM_CONTEXT, 'nope')).toBeUndefined();
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

	it('getConfig with the wrong key returns the server with apiKey omitted (does not throw)', async () => {
		// A key mismatch must not blank out the whole compute-config response —
		// every page that reads it (e.g. /projects) would 500. Strict detection
		// is `verifySecrets`'s job at boot, not this read path's.
		const writer = new LocalComputeServerStore(configPath, TEST_SECRET_KEY);
		await writer.savePlatformServers(
			SYSTEM_CONTEXT,
			[makePlatformServer({ apiKey: 'value' })],
			'a1'
		);

		const reader = new LocalComputeServerStore(configPath, OTHER_KEY);
		const got = await reader.getConfig(SYSTEM_CONTEXT, { includeApiKeys: true });
		expect(got.servers).toHaveLength(1);
		expect(got.servers[0].apiKey).toBeUndefined();

		// The same tolerance on the single-key path the solve now uses.
		expect(await reader.getServerApiKey(SYSTEM_CONTEXT, 'a1')).toBeUndefined();
	});

	it('verifySecrets reports key_mismatch when the at-rest key has rotated', async () => {
		const writer = new LocalComputeServerStore(configPath, TEST_SECRET_KEY);
		await writer.savePlatformServers(
			SYSTEM_CONTEXT,
			[makePlatformServer({ id: 'a1', label: 'Prod', apiKey: 'value' })],
			'a1'
		);

		const reader = new LocalComputeServerStore(configPath, OTHER_KEY);
		const report = await reader.verifySecrets();
		expect(report.ok).toBe(false);
		expect(report.plaintextFound).toBe(false);
		expect(report.failures).toHaveLength(1);
		expect(report.failures[0]).toMatchObject({
			serverId: 'a1',
			serverLabel: 'Prod',
			reason: 'key_mismatch'
		});
	});

	it('verifySecrets reports plaintext_on_disk for hand-edited config', async () => {
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
		const report = await store.verifySecrets();
		expect(report.ok).toBe(false);
		expect(report.plaintextFound).toBe(true);
		expect(report.failures[0]).toMatchObject({
			serverId: 'a1',
			reason: 'plaintext_on_disk'
		});
	});

	it('verifySecrets returns ok when every encrypted apiKey decrypts', async () => {
		const store = new LocalComputeServerStore(configPath, TEST_SECRET_KEY);
		await store.savePlatformServers(
			SYSTEM_CONTEXT,
			[
				makePlatformServer({ id: 'a1', apiKey: 'one' }),
				makePlatformServer({ id: 'a2', apiKey: 'two' }),
				makePlatformServer({ id: 'a3' }) // no apiKey — ignored
			],
			'a1'
		);

		const report = await store.verifySecrets();
		expect(report.ok).toBe(true);
		expect(report.failures).toEqual([]);
		expect(report.plaintextFound).toBe(false);
	});

	it('refuses to read a legacy plaintext apiKey from disk', async () => {
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
		await expect(store.getConfig(SYSTEM_CONTEXT, { includeApiKeys: true })).rejects.toThrow(
			/unencrypted apiKey/
		);
		// The key-free read never touches the secret, so it cannot detect this —
		// `verifySecrets` is the boot-time guard that does.
		await expect(store.getConfig(SYSTEM_CONTEXT)).resolves.toBeDefined();
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
