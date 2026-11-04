/**
 * Consent under forward-auth, through the real hook.
 *
 * Header-auth identity rides on `SELVA-*` headers every request, and SvelteKit's
 * internal fetch forwards only `cookie` and `authorization`, so consent must mint
 * in-process rather than through the app's own token endpoint. This drives a
 * proxied approval through `handle` with a real `HeaderAuthProvider`, so the
 * identity the hook resolves is the one that mints.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { LocalDataProvider, LocalStorageProvider } from '@selvajs/local-provider';
import { HeaderAuthProvider } from '@selvajs/header-auth-provider';
import { SYSTEM_CONTEXT, type SelvaConfig } from '@selvajs/platform';
import { DefinitionService } from '@selvajs/server/definitions';
import { resolveApiToken } from '@selvajs/server/http';
import { seedOrg, seedOrgMember, seedProject, seedProjectMember } from '@selvajs/server/testing';
import type { TestHarness } from '@selvajs/server/testing';
import { setTestProviders, clearTestProviders } from '#lib/server/__tests__/test-providers.js';
import { apiTokenCodec } from '#lib/server/apiTokens/token.server.js';
import { handle } from '../../../hooks.server';
import { actions } from '../authorize/+page.server';
import { POST as token } from '../token/+server';

const ORIGIN = 'https://selva.test';
const LOOPBACK = 'http://127.0.0.1:53121/callback';
const VERIFIER = 'v'.repeat(64);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const UPN = 'dana@acme.test';

let root: string;
let config: SelvaConfig;
let orgId: string;

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-header-consent-'));
	const env = {
		DATA_PATH: root,
		SELVA_HMAC_KEY: 'test-hmac-key-32-chars-min-length',
		SELVA_AT_REST_KEY: '0'.repeat(64)
	};
	const auth = HeaderAuthProvider.fromEnv(env);
	const data = LocalDataProvider.fromEnv(env);
	const storage = LocalStorageProvider.fromEnv(env);
	config = { auth, data, storage, tenancy: 'single', flags: {} };
	setTestProviders({
		config,
		tenancy: 'single',
		flags: {},
		definitionService: new DefinitionService(data, storage)
	});

	const h: TestHarness = {
		config,
		auth: { createUser: (upn) => auth.createUser(upn), findById: (id) => auth.getUser(id) }
	};
	// An admin already exists, so the hook's first-admin bootstrap leaves Dana alone.
	const admin = await auth.createUser('admin@acme.test');
	await data.ensureUser(SYSTEM_CONTEXT, admin.id);
	await data.permissions.set(SYSTEM_CONTEXT, admin.id, ['instance_admin']);

	const dana = await auth.createUser(UPN);
	await data.ensureUser(SYSTEM_CONTEXT, dana.id);
	const org = await seedOrg(h, { name: 'Acme', slug: 'acme', ownerId: admin.id });
	orgId = org.id;
	await seedOrgMember(h, { orgId, userId: dana.id, role: 'member' });
	const project = await seedProject(h, {
		orgId,
		name: 'Facades',
		slug: 'facades',
		ownerId: admin.id,
		visibility: 'org'
	});
	await seedProjectMember(h, { projectId: project.id, userId: dana.id, role: 'editor' });
});

afterEach(async () => {
	vi.restoreAllMocks();
	clearTestProviders();
	await fs.rm(root, { recursive: true, force: true });
});

const authorizeQuery = new URLSearchParams({
	client_id: 'selva-grasshopper',
	redirect_uri: LOOPBACK,
	response_type: 'code',
	code_challenge: CHALLENGE,
	code_challenge_method: 'S256',
	state: 'st',
	scope: 'upload',
	resource: ORIGIN
}).toString();

function approvalEvent(headers: Record<string, string>): RequestEvent {
	const url = new URL(`${ORIGIN}/oauth/authorize?${authorizeQuery}&/approve`);
	const form = new FormData();
	form.set('access', 'upload');
	form.set('orgId', orgId);
	return {
		url,
		params: {},
		route: { id: '/oauth/authorize' },
		request: new Request(url, {
			method: 'POST',
			body: form,
			headers: { origin: ORIGIN, ...headers }
		}),
		locals: {},
		cookies: { get: () => undefined, getAll: () => [], set() {}, delete() {}, serialize: () => '' },
		getClientAddress: () => '203.0.113.7',
		fetch: () => {
			throw new Error('consent must not call back into the app over fetch');
		}
	} as unknown as RequestEvent;
}

/** What SvelteKit does with the page action: a thrown redirect becomes a 303, a `fail` its status. */
async function runApprove(event: RequestEvent): Promise<Response> {
	try {
		const result = (await actions.approve(event as never)) as { status?: number } | undefined;
		return Response.json(result ?? null, { status: result?.status ?? 200 });
	} catch (err) {
		const r = err as { status?: number; location?: string };
		if (r.status === 303 && r.location) {
			return new Response(null, { status: 303, headers: { location: r.location } });
		}
		throw err;
	}
}

describe('consent under header-auth, through the hook', () => {
	it('mints for the user the proxy identified, and the key works', async () => {
		const res = await handle({
			event: approvalEvent({ 'SELVA-UserPrincipalName': UPN }),
			resolve: runApprove
		});
		expect(res.status).toBe(303);
		const back = new URL(res.headers.get('location')!);
		expect(back.origin + back.pathname).toBe(LOOPBACK);
		expect(back.searchParams.get('iss')).toBe(ORIGIN);

		const exchanged = await token({
			url: new URL(`${ORIGIN}/oauth/token`),
			request: new Request(`${ORIGIN}/oauth/token`, {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					grant_type: 'authorization_code',
					code: back.searchParams.get('code')!,
					client_id: 'selva-grasshopper',
					redirect_uri: LOOPBACK,
					code_verifier: VERIFIER,
					resource: ORIGIN
				}).toString()
			}),
			getClientAddress: () => '203.0.113.7'
		} as never);
		const body = (await exchanged.json()) as { access_token: string; scope: string };
		expect(body.scope).toBe('upload');

		// The background lastUsedAt write would race the temp-dir cleanup.
		vi.spyOn(config.data.apiTokens!, 'touchLastUsed').mockResolvedValue();
		const resolved = await resolveApiToken(
			new Request(`${ORIGIN}/api/v1/me`, {
				headers: { authorization: `Bearer ${body.access_token}` }
			}),
			{ codec: apiTokenCodec(), auth: config.auth, data: config.data }
		);
		expect(resolved).toMatchObject({ kind: 'ok', user: { email: UPN } });
		if (resolved.kind === 'ok') {
			expect(resolved.token).toMatchObject({ orgId, scopes: ['upload:all'] });
		}
	});

	it('sends a request the proxy didn’t identify to login, minting nothing', async () => {
		await expect(handle({ event: approvalEvent({}), resolve: runApprove })).rejects.toMatchObject({
			status: 303,
			location: expect.stringContaining('/login')
		});
		const minted = await config.data.apiTokens!.listByOrg(SYSTEM_CONTEXT, orgId);
		expect(minted.items).toEqual([]);
	});
});
