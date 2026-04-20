import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runStorageProviderConformance } from '@selva/platform/testing';
import { LocalStorageProvider } from '../LocalStorageProvider.js';

describe('LocalStorageProvider', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-storage-test-'));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	runStorageProviderConformance({
		name: 'LocalStorageProvider',
		createStorage: () => new LocalStorageProvider(tempDir),
		runner: { describe, it, expect }
	});
});
