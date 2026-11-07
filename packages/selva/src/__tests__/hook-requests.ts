import { vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import { grantPlatformPermissions, type TestProviders } from '#lib/server/__tests__/fixtures.js';
import { apiTokenCodec } from '#lib/server/apiTokens/token.server.js';

export const ORIGIN = 'https://selva.test';

export interface HookRequestInit {
	method?: string;
	headers?: Record<string, string>;
	body?: BodyInit;
	cookies?: Record<string, string>;
}

/** A request as SvelteKit hands it to `handle`, before any route has run. */
export function hookEvent(pathAndQuery: string, init: HookRequestInit = {}): RequestEvent {
	const url = new URL(pathAndQuery, ORIGIN);
	const jar = new Map(Object.entries(init.cookies ?? {}));
	return {
		url,
		params: {},
		route: { id: null },
		isDataRequest: false,
		request: new Request(url, {
			method: init.method ?? 'GET',
			headers: init.headers,
			body: init.body
		}),
		locals: {},
		cookies: {
			get: (name: string) => jar.get(name),
			getAll: () => [...jar].map(([name, value]) => ({ name, value })),
			set: (name: string, value: string) => void jar.set(name, value),
			delete: (name: string) => void jar.delete(name),
			serialize: () => ''
		},
		getClientAddress: () => '203.0.113.7'
	} as unknown as RequestEvent;
}

/** A `resolve` that records whether the request got past the hook. */
export const reached = () => vi.fn(async () => new Response('route reached'));

const DAY = 86_400_000;

/** A live `read:all` key for `userId`, minted with the codec the hook resolves against. */
export async function mintApiKey(t: TestProviders, userId: string, orgId: string) {
	// The resolver refuses a key whose owner may not hold one.
	const held = await t.config.data.permissions.getFor(SYSTEM_CONTEXT, userId);
	await grantPlatformPermissions(t, userId, [...new Set([...held, 'manage_api_tokens' as const])]);
	const codec = apiTokenCodec()!;
	const raw = codec.mintRawToken();
	const id = randomUUID();
	await t.config.data.apiTokens!.create(SYSTEM_CONTEXT, {
		id,
		userId,
		createdBy: userId,
		orgId,
		name: 'hook test',
		tokenHash: codec.hashToken(raw),
		scopes: ['read:all'],
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 30 * DAY).toISOString(),
		// Recent, so the resolver skips its background `lastUsedAt` write, which
		// would race the temp-dir cleanup.
		lastUsedAt: new Date().toISOString(),
		revokedAt: null
	});
	return { raw, id };
}
