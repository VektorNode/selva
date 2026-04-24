import { describe, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runInviteStoreConformance } from '@selva/platform/testing';
import { LocalInviteProvider } from '../LocalInviteProvider.js';

describe('LocalInviteProvider', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-invites-'));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	// Local provider has no FK constraints so the default scope ids are fine.
	runInviteStoreConformance({
		name: 'LocalInviteProvider',
		createStore: () => new LocalInviteProvider(tempDir)
	});
});
