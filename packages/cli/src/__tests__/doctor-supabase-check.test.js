// The reachability check talks to GoTrue, which refuses unauthenticated
// requests to its own health endpoint. Without the anon key a healthy project
// answers 401, and doctor reported that as "check project status" on every run
// against a working deployment — a warning nobody could act on, sitting next to
// a green migration-head check proving the same URL was fine.
//
// Run by `pnpm test` via node's built-in runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSupabase } from '../commands/doctor.js';

const ENV = {
	SUPABASE_URL: 'https://example.supabase.co',
	SUPABASE_ANON_KEY: 'sb_publishable_test',
	SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test'
};

/** Swap global fetch for the duration of one test. */
function withFetch(t, impl) {
	const original = globalThis.fetch;
	globalThis.fetch = impl;
	t.after(() => {
		globalThis.fetch = original;
	});
}

test('the health probe sends the anon key', async (t) => {
	let seen = null;
	withFetch(t, async (url, init) => {
		seen = { url, headers: init?.headers };
		return { ok: true, status: 200 };
	});

	const result = await checkSupabase(ENV);

	assert.equal(result.severity, 'green');
	assert.match(seen.url, /\/auth\/v1\/health$/);
	assert.equal(
		seen.headers?.apikey,
		ENV.SUPABASE_ANON_KEY,
		'without this header GoTrue 401s and a healthy project reads as broken'
	);
});

test('a 401 now means the key is wrong, not that the project is down', async (t) => {
	// With the key attached, 401 is a real finding: it is the project rejecting
	// the credential. That is a deployment that cannot authenticate anyone.
	withFetch(t, async () => ({ ok: false, status: 401 }));

	const result = await checkSupabase(ENV);

	assert.equal(result.severity, 'red');
	assert.match(result.line, /rejected SUPABASE_ANON_KEY/);
});

test('other non-OK statuses stay a warning', async (t) => {
	// A 503 is Supabase's problem, not the deployment's, and may be transient.
	withFetch(t, async () => ({ ok: false, status: 503 }));

	const result = await checkSupabase(ENV);

	assert.equal(result.severity, 'yellow');
	assert.match(result.line, /responded 503/);
});

test('being offline is a warning, never a failure', async (t) => {
	// Scaffolding on a laptop with no network must not report a broken project.
	withFetch(t, async () => {
		throw new Error('getaddrinfo ENOTFOUND');
	});

	const result = await checkSupabase(ENV);

	assert.equal(result.severity, 'yellow');
	assert.match(result.line, /unreachable/);
});

test('missing configuration is reported before anything is fetched', async (t) => {
	let fetched = false;
	withFetch(t, async () => {
		fetched = true;
		return { ok: true, status: 200 };
	});

	for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
		const result = await checkSupabase({ ...ENV, [key]: undefined });
		assert.equal(result.severity, 'red', `${key} unset should be red`);
		assert.match(result.line, new RegExp(key));
	}
	assert.equal(fetched, false, 'no point probing a URL we know is unusable');
});

test('a malformed URL is caught rather than thrown at the operator', async (t) => {
	withFetch(t, async () => ({ ok: true, status: 200 }));

	const result = await checkSupabase({ ...ENV, SUPABASE_URL: 'not-a-url' });

	assert.equal(result.severity, 'red');
	assert.match(result.line, /is not a valid URL/);
});
