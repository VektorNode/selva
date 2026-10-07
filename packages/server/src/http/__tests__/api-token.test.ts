import { describe, it, expect, vi } from 'vitest';
import type { ApiToken, AuthUser, IApiTokenStore, OrgMember } from '@selvajs/platform';
import { resolveApiToken, type ResolveApiTokenDeps } from '../api-token.js';
import { createApiTokenCodec } from '../../tokens/api-token-codec.js';

const codec = createApiTokenCodec('k'.repeat(32));
const ORG = 'org-a';
const DAY = 86_400_000;

interface World {
	raw: string;
	token: ApiToken;
	user: AuthUser;
	member: OrgMember | null;
	touch: ReturnType<typeof vi.fn>;
	deps: ResolveApiTokenDeps;
}

function world(overrides: { token?: Partial<ApiToken>; user?: Partial<AuthUser> } = {}): World {
	const raw = codec.mintRawToken();
	const token: ApiToken = {
		id: 'tok-1',
		userId: 'u1',
		createdBy: 'u1',
		orgId: ORG,
		name: 'ci',
		tokenHash: codec.hashToken(raw),
		scopes: ['read:all'],
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 30 * DAY).toISOString(),
		lastUsedAt: null,
		revokedAt: null,
		...overrides.token
	};
	const user: AuthUser = {
		id: 'u1',
		email: 'u1@test.local',
		createdAt: new Date().toISOString(),
		...overrides.user
	};
	const w = {
		raw,
		token,
		user,
		member: {
			orgId: ORG,
			userId: 'u1',
			role: 'member',
			permissions: ['manage_projects'],
			joinedAt: '',
			updatedAt: '',
			updatedBy: ''
		} as OrgMember | null,
		touch: vi.fn(async () => {})
	} as World;
	const store = {
		getByTokenHash: async (_ctx: unknown, hash: string) =>
			hash === w.token.tokenHash ? w.token : null,
		touchLastUsed: w.touch
	} as unknown as IApiTokenStore;
	w.deps = {
		codec,
		auth: { getUser: async (id: string) => (id === w.user.id ? w.user : null) },
		data: {
			apiTokens: store,
			orgs: {
				getOrgMember: async () => w.member,
				listOrgs: async () => ({ items: [] })
			} as never
		}
	};
	return w;
}

function req(path: string, headers: Record<string, string> = {}): Request {
	return new Request(`http://selva.test${path}`, { headers });
}

const bearer = (raw: string) => ({ authorization: `Bearer ${raw}` });

describe('resolveApiToken', () => {
	it('is none without a bearer, or with another token family', async () => {
		const w = world();
		expect(await resolveApiToken(req('/api/v1/projects'), w.deps)).toEqual({ kind: 'none' });
		expect(await resolveApiToken(req('/api/v1/projects', bearer('share_abc')), w.deps)).toEqual({
			kind: 'none'
		});
	});

	it('resolves a live key to the owner, acting in the token’s org, narrowed', async () => {
		const w = world();
		const result = await resolveApiToken(req('/api/v1/projects', bearer(w.raw)), w.deps);
		expect(result.kind).toBe('ok');
		if (result.kind !== 'ok') return;
		expect(result.user.id).toBe('u1');
		expect(result.ctx.actingOrgId).toBe(ORG);
		expect(result.ctx.platformPermissions).toEqual([]);
		expect(result.ctx.orgPermissions).toEqual(['manage_projects']);
		expect(result.ctx.apiScope?.tokenId).toBe('tok-1');
	});

	it('rejects a key in the query string with 400, header or not', async () => {
		const w = world();
		const result = await resolveApiToken(req(`/api/v1/projects?token=${w.raw}`), w.deps);
		expect(result).toMatchObject({ kind: 'rejected', status: 400 });
	});

	it('does not mistake ordinary query text for a key', async () => {
		const w = world();
		const result = await resolveApiToken(req('/api/v1/projects?q=selva_tutorial'), w.deps);
		expect(result).toEqual({ kind: 'none' });
	});

	it.each(['/api/admin/users', '/api/files/x', '/library', '/api/v1'])(
		'refuses a key outside /api/v1/: %s',
		async (path) => {
			const w = world();
			const result = await resolveApiToken(req(path, bearer(w.raw)), w.deps);
			expect(result).toMatchObject({ kind: 'rejected', status: 403 });
		}
	);

	it('gives 503 when the host has tokens switched off', async () => {
		const w = world();
		const noStore = { ...w.deps, data: { ...w.deps.data, apiTokens: undefined } };
		const noCodec = { ...w.deps, codec: undefined };
		for (const deps of [noStore, noCodec]) {
			const result = await resolveApiToken(req('/api/v1/projects', bearer(w.raw)), deps);
			expect(result).toMatchObject({ status: 503, code: 'API_TOKENS_UNAVAILABLE' });
		}
	});

	it('rejects a mistyped key before looking it up', async () => {
		const w = world();
		const getByTokenHash = vi.spyOn(w.deps.data.apiTokens!, 'getByTokenHash');
		const typo = w.raw.slice(0, -2) + (w.raw.endsWith('aa') ? 'bb' : 'aa');
		const result = await resolveApiToken(req('/api/v1/projects', bearer(typo)), w.deps);
		expect(result).toMatchObject({ kind: 'rejected', status: 401 });
		expect(getByTokenHash).not.toHaveBeenCalled();
	});

	it('rejects an unknown key', async () => {
		const w = world();
		const other = codec.mintRawToken();
		const result = await resolveApiToken(req('/api/v1/projects', bearer(other)), w.deps);
		expect(result).toMatchObject({ kind: 'rejected', status: 401 });
	});

	it('rejects a disabled owner', async () => {
		const w = world({ user: { disabled: true } });
		const result = await resolveApiToken(req('/api/v1/projects', bearer(w.raw)), w.deps);
		expect(result).toMatchObject({ kind: 'rejected', status: 401 });
	});

	it('rejects an owner no longer in the token’s org', async () => {
		const w = world();
		w.member = null;
		const result = await resolveApiToken(req('/api/v1/projects', bearer(w.raw)), w.deps);
		expect(result).toMatchObject({ kind: 'rejected', status: 401 });
	});

	it('writes lastUsedAt when stale and skips it when fresh', async () => {
		const stale = world({
			token: { lastUsedAt: new Date(Date.now() - 10 * 60_000).toISOString() }
		});
		await resolveApiToken(req('/api/v1/projects', bearer(stale.raw)), stale.deps);
		expect(stale.touch).toHaveBeenCalledOnce();

		const fresh = world({ token: { lastUsedAt: new Date(Date.now() - 60_000).toISOString() } });
		await resolveApiToken(req('/api/v1/projects', bearer(fresh.raw)), fresh.deps);
		expect(fresh.touch).not.toHaveBeenCalled();
	});

	it('still resolves when the lastUsedAt write fails', async () => {
		const w = world();
		w.touch.mockRejectedValueOnce(new Error('disk full'));
		const result = await resolveApiToken(req('/api/v1/projects', bearer(w.raw)), w.deps);
		expect(result.kind).toBe('ok');
	});
});
