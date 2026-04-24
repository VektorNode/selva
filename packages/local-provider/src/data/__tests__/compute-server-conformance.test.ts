import { describe, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runComputeServerStoreConformance } from '@selva/platform/testing';
import { LocalComputeServerStore } from '../LocalComputeServerStore.js';

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
			new LocalComputeServerStore(path.join(tempDir, 'compute.config.json'))
	});
});
