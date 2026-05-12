import { describe, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runShareLinkStoreConformance } from '@selvajs/platform/testing';
import { LocalShareLinkStore } from '../LocalShareLinkStore.js';

describe('LocalShareLinkStore', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-share-'));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	runShareLinkStoreConformance({
		name: 'LocalShareLinkStore',
		createStore: () => new LocalShareLinkStore({ filePath: path.join(tempDir, 'share-links.json') })
	});
});
