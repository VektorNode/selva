import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVitestConfig } from '@selvajs/config/vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async () =>
	createVitestConfig({
		test: {
			// Conformance tests hit a live local Supabase stack — give the network
			// room to breathe (bucket listing, cleanup between tests).
			testTimeout: 30_000,
			hookTimeout: 30_000,
			// Pick up test env from .env.test if present. Created by `npx supabase start`:
			// copy the printed URL + keys into packages/providers/supabase/.env.test.
			env: await reachableTestEnv(),
			// Run every test file serially. The conformance suites all reset the
			// shared DB in their beforeEach hooks; parallel execution would have
			// one file wiping state the next file is mid-write on.
			fileParallelism: false,
			// Force a single worker — with fileParallelism off this shouldn't
			// matter, but belt-and-braces against vitest's default pool behavior.
			pool: 'forks',
			maxForks: 1,
			minForks: 1
		}
	});

/**
 * `.env.test` is checked in with local-stack defaults, so its mere presence
 * can't mean "a stack is running" — without Docker up, every conformance
 * suite would fail with an opaque `TypeError: fetch failed` per test. Probe
 * the REST endpoint once here (before workers spawn) and withhold the creds
 * when it's unreachable, so the suites take their existing no-creds skip path
 * and the run reports one clear reason instead of hundreds of failures.
 */
async function reachableTestEnv(): Promise<Record<string, string>> {
	const env = loadTestEnv();
	const url = env.SUPABASE_URL;
	if (!url) return env;

	const reason = await probe(url, env.SUPABASE_ANON_KEY);
	if (!reason) return env;

	console.warn(
		`\n⚠  Supabase conformance suites skipped: ${url} is unreachable (${reason}).\n` +
			`   Start the stack with \`cd packages/providers/supabase && npx supabase start\`.\n` +
			`   If the schema is behind the migrations, follow with \`npx supabase db reset\`.\n`
	);
	const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ...rest } = env;
	return rest;
}

/** Returns null when the stack answers, else a short reason for the warning. */
async function probe(url: string, anonKey: string | undefined): Promise<string | null> {
	const signal = AbortSignal.timeout(3000);
	try {
		// PostgREST answers 401 without a key and 200 with one — both prove the
		// stack is up, so any HTTP response counts as reachable. Only a
		// transport-level throw (connection refused, DNS, timeout) means "down".
		await fetch(new URL('/rest/v1/', url), {
			headers: anonKey ? { apikey: anonKey } : undefined,
			signal
		});
		return null;
	} catch (err) {
		if (signal.aborted) return 'timed out';
		return err instanceof Error ? err.message : String(err);
	}
}

function loadTestEnv(): Record<string, string> {
	const envPath = path.resolve(__dirname, '.env.test');
	if (!fs.existsSync(envPath)) return {};
	const out: Record<string, string> = {};
	for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
		if (!m) continue;
		const [, k, rawV] = m;
		out[k] = rawV.replace(/^["']|["']$/g, '');
	}
	return out;
}
