import { describe, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runApiTokenStoreConformance } from '@selvajs/platform/testing';
import { LocalApiTokenStore } from '../LocalApiTokenStore.js';

describe('LocalApiTokenStore', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-api-tokens-'));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	runApiTokenStoreConformance({
		name: 'LocalApiTokenStore',
		createStore: () => new LocalApiTokenStore(tempDir)
	});
});
