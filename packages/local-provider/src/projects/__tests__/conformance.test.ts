import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runProjectStoreConformance } from '@selva/platform/testing';
import { LocalOrgStoreLoader } from '../../organizations/LocalOrganizationProvider.js';
import { LocalProjectProvider } from '../LocalProjectProvider.js';

describe('LocalProjectProvider', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-test-'));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	runProjectStoreConformance({
		name: 'LocalProjectProvider',
		createStore: async () => {
			const loader = new LocalOrgStoreLoader(tempDir);
			const store = new LocalProjectProvider(loader);
			// Bootstrap the store so the org exists, then get its id
			const storeData = await loader.get();
			return { store, orgId: storeData.org.id };
		},
		runner: { describe, it, expect }
	});
});
