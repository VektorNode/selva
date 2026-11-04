#!/usr/bin/env node
/**
 * Post-build: write build/runtime-meta.json, read by @selvajs/cli.
 *
 * The provider code (and its compiled-in EXPECTED_MIGRATION_HEAD) is bundled
 * into this build, but the migration SQL ships separately in
 * @selvajs/supabase-provider, which an operator can leave stale. The CLI needs
 * the head THIS runtime expects without booting it, so it can tell a database
 * that is behind the app from one that only matches an old provider install.
 */

import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const selvaDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(selvaDir, '..', 'providers', 'supabase', 'supabase', 'migrations');

// Same derivation `migration-head.test.ts` checks EXPECTED_MIGRATION_HEAD against.
const supabaseMigrationHead = readdirSync(migrationsDir)
	.filter((f) => /^\d{14}_.+\.sql$/.test(f))
	.map((f) => f.slice(0, 14))
	.sort()
	.pop();
if (!supabaseMigrationHead) throw new Error(`No migrations found in ${migrationsDir}`);

writeFileSync(
	join(selvaDir, 'build', 'runtime-meta.json'),
	JSON.stringify({ supabaseMigrationHead }, null, '\t') + '\n'
);
console.log(`✓ build/runtime-meta.json (supabaseMigrationHead ${supabaseMigrationHead})`);
