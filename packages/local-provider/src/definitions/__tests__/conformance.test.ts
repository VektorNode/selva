import { describe, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runDefinitionStoreConformance } from '@selva/platform/testing';
import { LocalDefinitionMetaProvider } from '../LocalDefinitionMetaProvider.js';

describe('LocalDefinitionMetaProvider', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-test-'));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	runDefinitionStoreConformance({
		name: 'LocalDefinitionMetaProvider',
		createStore: () => new LocalDefinitionMetaProvider(tempDir)
	});
});
