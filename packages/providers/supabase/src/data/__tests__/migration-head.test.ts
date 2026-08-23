/**
 * Drift guard for the app↔DB schema handshake (audit O3).
 *
 * `EXPECTED_MIGRATION_HEAD` is a hand-maintained constant; this test derives
 * the real head from the migrations directory so CI fails the moment someone
 * adds a migration without bumping the constant. Runs without a live stack.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPECTED_MIGRATION_HEAD } from '../migrationHead.js';

const MIGRATIONS_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	'..',
	'..',
	'..',
	'supabase',
	'migrations'
);

describe('EXPECTED_MIGRATION_HEAD', () => {
	it('matches the newest migration in supabase/migrations/', () => {
		const stamps = readdirSync(MIGRATIONS_DIR)
			.filter((f) => /^\d{14}_.+\.sql$/.test(f))
			.map((f) => f.slice(0, 14))
			.sort();
		expect(stamps.length).toBeGreaterThan(0);
		expect(EXPECTED_MIGRATION_HEAD).toBe(stamps[stamps.length - 1]);
	});
});
