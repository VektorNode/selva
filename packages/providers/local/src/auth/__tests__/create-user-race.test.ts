import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createLocalAuthUserStore } from '../users.js';

let dir: string;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-create-user-'));
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

describe('createUser under a double submit', () => {
	it('creates one account', async () => {
		const store = createLocalAuthUserStore(path.join(dir, 'auth-users.json'));

		const results = await Promise.allSettled([
			store.createUser('new@acme.test', 'password-one'),
			store.createUser('new@acme.test', 'password-two')
		]);

		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(await store.listUsers()).toHaveLength(1);
	});
});
