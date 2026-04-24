import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	test: {
		// Conformance tests hit a live local Supabase stack — give the network
		// room to breathe (bucket listing, cleanup between tests).
		testTimeout: 30_000,
		hookTimeout: 30_000,
		// Pick up test env from .env.test if present. Created by `npx supabase start`:
		// copy the printed URL + keys into packages/supabase-provider/.env.test.
		env: loadTestEnv(),
		// Run every test file serially. The conformance suites all reset the
		// shared DB in their beforeEach hooks; parallel execution would have
		// one file wiping state the next file is mid-write on.
		fileParallelism: false,
		// Force a single worker — with fileParallelism off this shouldn't
		// matter, but belt-and-braces against vitest's default pool behavior.
		pool: 'forks',
		poolOptions: {
			forks: { singleFork: true }
		}
	}
});

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
