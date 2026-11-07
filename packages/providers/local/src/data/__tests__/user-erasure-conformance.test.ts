import { afterEach, beforeEach, describe } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { runUserErasureConformance } from '@selvajs/platform/testing';
import { LocalDataProvider } from '../LocalDataProvider.js';

describe('LocalDataProvider', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-erasure-conformance-'));
	});

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true });
	});

	runUserErasureConformance({
		name: 'LocalDataProvider',
		createProvider: () =>
			LocalDataProvider.fromEnv({ DATA_PATH: dir, SELVA_AT_REST_KEY: 'a'.repeat(64) })
	});
});
