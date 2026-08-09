import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestContext } from '@selvajs/platform';

// RLS dispatch is entirely a question of WHICH key each returned client was
// built with, so mock `createClient` to a spy that records (key, options) and
// hands back a distinguishable stub — no live Supabase stack needed, and no
// realtime-js load (which throws without native WebSocket on older Node).
vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn((_url: string, key: string, options: unknown) => ({
		__key: key,
		__options: options
	}))
}));

import { createClient } from '@supabase/supabase-js';
import { buildClientBundle } from '../client.js';

const createClientMock = vi.mocked(createClient);

const URL = 'https://project.supabase.co';
const ANON_KEY = 'anon-key';
const SERVICE_ROLE_KEY = 'service-role-key';

/** The key a returned client was constructed with — the RLS role in disguise. */
function keyOf(client: unknown): string {
	return (client as { __key: string }).__key;
}

/** Build a context with the given adapterContext and system flag. */
function ctx(adapterContext: unknown, system = false): RequestContext {
	return { system, adapterContext } as unknown as RequestContext;
}

function build() {
	return buildClientBundle({
		supabaseUrl: URL,
		anonKey: ANON_KEY,
		serviceRoleKey: SERVICE_ROLE_KEY
	});
}

/**
 * A previous version fell back to service-role when the session token was
 * absent — a fail-OPEN footgun where any synthetic ctx (share-token resolve,
 * background job, hand-built context) silently bypassed RLS. Contract now: you
 * opt INTO service-role with `system: true`; every other shape gets an
 * RLS-active client. These tests pin that so the fail-open default can't creep back.
 */
describe('buildClientBundle.forRequest — fail-closed RLS dispatch (audit S2)', () => {
	beforeEach(() => {
		createClientMock.mockClear();
	});

	it('uses service-role ONLY when ctx.system === true', () => {
		const client = build().forRequest(ctx({ sessionToken: 'ignored-when-system' }, true));
		expect(keyOf(client)).toBe(SERVICE_ROLE_KEY);
	});

	it('uses the anon key when no session token is present (the fail-closed default)', () => {
		const client = build().forRequest(ctx({}));
		expect(keyOf(client)).toBe(ANON_KEY);
		expect(keyOf(client)).not.toBe(SERVICE_ROLE_KEY);
	});

	it('uses the anon key for a null / missing adapterContext', () => {
		expect(keyOf(build().forRequest(ctx(null)))).toBe(ANON_KEY);
		expect(keyOf(build().forRequest(ctx(undefined)))).toBe(ANON_KEY);
	});

	it('treats an empty-string session token as absent (anon, not service-role)', () => {
		expect(keyOf(build().forRequest(ctx({ sessionToken: '' })))).toBe(ANON_KEY);
	});

	it('treats a non-string session token as absent (anon, not service-role)', () => {
		expect(keyOf(build().forRequest(ctx({ sessionToken: 12345 })))).toBe(ANON_KEY);
	});

	it('builds a user-scoped client (anon key + Bearer token) when a token IS present', () => {
		const bundle = build();
		const client = bundle.forRequest(ctx({ sessionToken: 'jwt-abc' }));
		// User-scoped still runs under the anon key — RLS + auth.uid() come from
		// the JWT in the Authorization header, not from the key.
		expect(keyOf(client)).toBe(ANON_KEY);
		const opts = createClientMock.mock.calls.at(-1)?.[2] as {
			global?: { headers?: Record<string, string> };
		};
		expect(opts?.global?.headers?.Authorization).toBe('Bearer jwt-abc');
	});

	it('never passes the service-role key for any non-system context shape', () => {
		const bundle = build();
		// Building a bundle eagerly constructs its own service-role client
		// (`serviceClient`); clear that call so only forRequest dispatch remains.
		createClientMock.mockClear();
		for (const adapterContext of [
			{},
			null,
			undefined,
			{ sessionToken: '' },
			{ sessionToken: 12345 },
			{ sessionToken: 'jwt-abc' }
		]) {
			bundle.forRequest(ctx(adapterContext, false));
		}
		const keysUsed = createClientMock.mock.calls.map((call) => call[1]);
		expect(keysUsed).not.toContain(SERVICE_ROLE_KEY);
	});

	it('system dispatch ignores the session token entirely', () => {
		// system is the sole service-role gate: a JWT present must not downgrade it,
		// and a JWT absent must not be required for it.
		expect(keyOf(build().forRequest(ctx({ sessionToken: 'jwt-abc' }, true)))).toBe(
			SERVICE_ROLE_KEY
		);
		expect(keyOf(build().forRequest(ctx({}, true)))).toBe(SERVICE_ROLE_KEY);
	});
});
