import { describe, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runOrgStoreConformance } from '@selva/platform/testing';
import { LocalOrganizationProvider, LocalOrgStoreLoader } from '../LocalOrganizationProvider.js';

describe('LocalOrganizationProvider', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-test-'));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	runOrgStoreConformance({
		name: 'LocalOrganizationProvider',
		createStore: () => new LocalOrganizationProvider(new LocalOrgStoreLoader(tempDir))
	});
});
