// Supabase schema head: what the installed runtime expects, what the installed
// provider can migrate to, and what the database is at. These are three
// separate numbers. The runtime bundles the provider's code but not its SQL,
// so `selva update` can move the runtime past a provider install that stays
// pinned. Comparing the database against the provider then reports a match
// while the app degrades /api/health to 503.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { green, yellow, red } from './result.js';

const HEAD_RE = /^\d{14}$/;

/** Head the installed @selvajs/selva was built against, or null for a runtime that predates runtime-meta.json. */
export function readRuntimeMigrationHead(dir) {
	try {
		const meta = JSON.parse(
			readFileSync(
				join(dir, 'node_modules', '@selvajs', 'selva', 'build', 'runtime-meta.json'),
				'utf8'
			)
		);
		return HEAD_RE.test(meta?.supabaseMigrationHead) ? meta.supabaseMigrationHead : null;
	} catch {
		return null;
	}
}

/** Newest migration the installed @selvajs/supabase-provider ships, or null when it isn't installed. */
export function readProviderMigrationHead(dir) {
	const migrationsDir = join(
		dir,
		'node_modules',
		'@selvajs',
		'supabase-provider',
		'supabase',
		'migrations'
	);
	if (!existsSync(migrationsDir)) return null;
	return (
		readdirSync(migrationsDir)
			.filter((f) => /^\d{14}_.+\.sql$/.test(f))
			.map((f) => f.slice(0, 14))
			.sort()
			.pop() ?? null
	);
}

/** The npm dist-tag matching the installed runtime: a pre-release runtime needs the provider's beta migrations. */
export function providerTagFor(runtimeVersion) {
	return runtimeVersion?.includes('-') ? 'beta' : 'latest';
}

/**
 * `{ head }` on success, `{ missing: true }` when selva.migration_head() doesn't
 * exist yet, `{ error }` when the database couldn't be asked.
 */
export async function fetchDatabaseMigrationHead(env) {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 4000);
		const res = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/migration_head', {
			method: 'POST',
			headers: {
				apikey: env.SUPABASE_SERVICE_ROLE_KEY,
				Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
				'Content-Type': 'application/json',
				// The function lives in the selva schema the app is pinned to.
				'Content-Profile': 'selva'
			},
			body: '{}',
			signal: controller.signal
		});
		clearTimeout(timer);
		if (res.status === 404) return { missing: true };
		if (!res.ok) return { error: `migration_head RPC responded ${res.status}` };
		return { head: String((await res.json()) ?? '') };
	} catch (err) {
		return { error: err.message ?? String(err) };
	}
}

function migrateSteps(tag, providerBehind) {
	return [
		...(providerBehind ? [`npm install --prefer-online @selvajs/supabase-provider@${tag}`] : []),
		'npx selva-supabase',
		'npx supabase db push'
	].join(' && ');
}

/**
 * Pure verdict, so the three-way comparison is testable without disk or network.
 * `runtime` is null for an old runtime; the provider head is then the best guess.
 * String comparison is safe: every head is a fixed-width timestamp.
 */
export function judgeMigrationHeads({ runtime, provider, database, tag }) {
	const expected = runtime ?? provider;
	if (!expected) {
		return red(
			'@selvajs/supabase-provider is not installed, so the migration SQL is missing. ' +
				'Run `selva migrate` to add it, then `npm install`.'
		);
	}
	const providerBehind = !provider || provider < expected;
	const steps = migrateSteps(tag, providerBehind);
	const providerNote =
		runtime && providerBehind
			? ` The installed @selvajs/supabase-provider only reaches ${provider ?? '(none)'}, so syncing it copies nothing new.`
			: '';

	if (database.error) return yellow(`Migration-head check skipped (${database.error})`);
	if (database.missing) {
		return red(
			`Database is missing selva.migration_head(): migrations are pending (expected head ${expected}).${providerNote} Run: ${steps}`
		);
	}
	if (!database.head) {
		return red(
			`Database reports no applied migrations (expected head ${expected}).${providerNote} Run: ${steps}`
		);
	}
	if (database.head < expected) {
		const against = runtime ? "the app's expected" : 'the installed provider';
		return red(
			`Database migration head ${database.head} is behind ${against} ${expected}. ` +
				`/api/health returns 503 and writes that need the newer schema fail.${providerNote} Run: ${steps}`
		);
	}
	if (runtime && providerBehind) {
		// The database is fine today; the next upgrade's sync would silently copy nothing.
		return yellow(
			`Database migration head ${database.head} matches the app, but @selvajs/supabase-provider ` +
				`is at ${provider ?? '(none)'}. Run: npm install --prefer-online @selvajs/supabase-provider@${tag}`
		);
	}
	return green(
		`Database migration head ${database.head} matches the ${runtime ? 'app' : 'installed provider'}`
	);
}

export async function checkSupabaseMigrations(dir, env, runtimeVersion) {
	if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
		return yellow('Migration-head check skipped: Supabase env incomplete');
	}
	const runtime = readRuntimeMigrationHead(dir);
	const provider = readProviderMigrationHead(dir);
	if (!runtime && !provider) {
		return judgeMigrationHeads({ runtime, provider, database: {}, tag: 'latest' });
	}
	return judgeMigrationHeads({
		runtime,
		provider,
		database: await fetchDatabaseMigrationHead(env),
		tag: providerTagFor(runtimeVersion)
	});
}
