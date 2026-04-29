import { describe, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runComputeServerStoreConformance } from '@selvajs/platform/testing';
import { LocalComputeServerStore } from '../LocalComputeServerStore.js';

const TEST_SECRET_KEY = Buffer.alloc(32, 0x42);

describe('LocalComputeServerStore', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-compute-'));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	runComputeServerStoreConformance({
		name: 'LocalComputeServerStore',
		createStore: () =>
			new LocalComputeServerStore(path.join(tempDir, 'compute.config.json'), TEST_SECRET_KEY)
	});
});
