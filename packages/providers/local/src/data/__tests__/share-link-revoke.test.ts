import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import { LocalShareLinkStore } from '../LocalShareLinkStore.js';

let dir: string;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-share-revoke-'));
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

describe('LocalShareLinkStore.revoke', () => {
	it('answers an unknown id with a 404, as Supabase does', async () => {
		const store = new LocalShareLinkStore({ filePath: path.join(dir, 'share-links.json') });
		await expect(store.revoke(SYSTEM_CONTEXT, 'missing')).rejects.toMatchObject({
			statusCode: 404
		});
	});
});
