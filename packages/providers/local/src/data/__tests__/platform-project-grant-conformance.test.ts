import { describe, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runPlatformProjectGrantStoreConformance } from '@selvajs/platform/testing';
import { LocalPlatformProjectGrantStore } from '../LocalPlatformProjectGrantStore.js';

describe('LocalPlatformProjectGrantStore', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-test-'));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	runPlatformProjectGrantStoreConformance({
		name: 'LocalPlatformProjectGrantStore',
		createStore: () =>
			new LocalPlatformProjectGrantStore(path.join(tempDir, 'platform-project-grants.json'))
	});
});
