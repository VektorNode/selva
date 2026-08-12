import { describe, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runInviteStoreConformance } from '@selvajs/platform/testing';
import { LocalInviteStore } from '../LocalInviteStore.js';

describe('LocalInviteStore', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-invites-'));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	// No FK constraints to satisfy here, unlike Supabase's createScope — default scope ids are fine.
	runInviteStoreConformance({
		name: 'LocalInviteStore',
		createStore: () => new LocalInviteStore(tempDir)
	});
});
