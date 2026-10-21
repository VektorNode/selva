import { describe, it, expect, vi } from 'vitest';
import type {
	ApiToken,
	AuthUser,
	IApiTokenStore,
	OrgMember,
	PlatformPermission,
	Project,
	ProjectMember,
	RequestContext
} from '@selvajs/platform';
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
	platformPermissions: PlatformPermission[];
	/** The org's projects, and the owner's role in each (absent: not a member). */
	projects: Project[];
	roles: Map<string, ProjectMember['role']>;
	touch: ReturnType<typeof vi.fn>;
	deps: ResolveApiTokenDeps;
}

function project(id: string): Project {
	return {
		id,
		orgId: ORG,
		name: id,
		slug: id,
		visibility: 'org',
		ownerId: 'someone',
		autoJoinOnUpload: false
	} as Project;
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
		platformPermissions: ['manage_api_tokens'],
		projects: [project('p1')],
		roles: new Map(),
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
				getOrgMembersFor: async (_ctx: unknown, ids: string[]) =>
					new Map(ids.map((id) => [id, w.member])),
				listOrgs: async () => ({ items: [] })
			} as never,
			permissions: { getFor: async () => w.platformPermissions } as never,
			projects: {
				listProjects: async () => ({ items: w.projects }),
				getProjectMembersFor: async (_ctx: unknown, ids: string[]) =>
					new Map(
						ids.map((id) => {
							const role = w.roles.get(id);
							return [id, role ? ({ projectId: id, userId: 'u1', role } as ProjectMember) : null];
						})
					)
			} as never,
			platformProjectGrants: { listByProjects: async () => new Map() } as never,
			definitions: {} as never
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

describe('resolveApiToken without a holder policy', () => {
	it('refuses the key once its owner loses manage_api_tokens, without revoking it', async () => {
		const w = world();
		expect((await resolveApiToken(req('/api/v1/projects', bearer(w.raw)), w.deps)).kind).toBe('ok');

		w.platformPermissions = [];
		expect(await resolveApiToken(req('/api/v1/projects', bearer(w.raw)), w.deps)).toMatchObject({
			kind: 'rejected',
			status: 403,
			code: 'API_TOKEN_HOLDER_REFUSED'
		});
		expect(w.token.revokedAt).toBeNull();
	});
});

describe('resolveApiToken for a key that only reads and uploads', () => {
	function uploader(scopes = ['upload:all']) {
		const w = world({ token: { scopes } });
		w.platformPermissions = [];
		w.roles.set('p1', 'editor');
		return w;
	}

	it('resolves without manage_api_tokens while the owner can create a definition', async () => {
		const w = uploader();
		const result = await resolveApiToken(req('/api/v1/projects', bearer(w.raw)), w.deps);
		expect(result.kind).toBe('ok');
		if (result.kind === 'ok') expect(result.ctx.apiScope?.expiresAt).toBe(w.token.expiresAt);
	});

	it('stops working when the owner loses their last editable project', async () => {
		const w = uploader(['read:all', 'upload:all']);
		expect((await resolveApiToken(req('/api/v1/projects', bearer(w.raw)), w.deps)).kind).toBe('ok');

		w.roles.set('p1', 'viewer');
		expect(await resolveApiToken(req('/api/v1/projects', bearer(w.raw)), w.deps)).toMatchObject({
			kind: 'rejected',
			status: 403,
			code: 'API_TOKEN_HOLDER_REFUSED'
		});
		expect(w.token.revokedAt).toBeNull();
	});

	it('counts a commons project, which takes anyone’s uploads', async () => {
		const w = uploader();
		w.roles.clear();
		w.projects = [{ ...project('commons'), visibility: 'public', autoJoinOnUpload: true }];
		expect((await resolveApiToken(req('/api/v1/projects', bearer(w.raw)), w.deps)).kind).toBe('ok');
	});

	it.each([[['write:all']], [['solve:all']], [['upload:all', 'solve:all']]])(
		'still needs manage_api_tokens for %j',
		async (scopes) => {
			const w = uploader(scopes);
			expect(await resolveApiToken(req('/api/v1/projects', bearer(w.raw)), w.deps)).toMatchObject({
				code: 'API_TOKEN_HOLDER_REFUSED'
			});
		}
	);

	it('treats a scope it can’t parse as broad', async () => {
		const w = uploader(['upload:all', 'admin:all']);
		expect(await resolveApiToken(req('/api/v1/projects', bearer(w.raw)), w.deps)).toMatchObject({
			code: 'API_TOKEN_HOLDER_REFUSED'
		});
	});
});

describe('resolveApiToken with a holder policy', () => {
	it('asks the policy with the owner’s live context in the token’s org, platform permissions included', async () => {
		const w = world();
		const seen: RequestContext[] = [];
		const seenScopes: unknown[] = [];
		w.deps.mayHoldApiTokens = (ctx, scopes) => (seen.push(ctx), seenScopes.push(scopes), true);
		const result = await resolveApiToken(req('/api/v1/projects', bearer(w.raw)), w.deps);
		expect(result.kind).toBe('ok');
		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({
			actingOrgId: ORG,
			platformPermissions: ['manage_api_tokens'],
			orgPermissions: ['manage_projects']
		});
		expect(seen[0]!.apiScope).toBeUndefined();
		expect(seenScopes).toEqual([[{ action: 'read', resource: { kind: 'all' } }]]);
		if (result.kind === 'ok') expect(result.ctx.platformPermissions).toEqual([]);
	});

	it('refuses the key with 403 once the policy turns false, without revoking it', async () => {
		const w = world();
		let holds = true;
		w.deps.mayHoldApiTokens = (ctx) => holds && ctx.orgPermissions.includes('manage_projects');
		expect((await resolveApiToken(req('/api/v1/projects', bearer(w.raw)), w.deps)).kind).toBe('ok');

		holds = false;
		expect(await resolveApiToken(req('/api/v1/projects', bearer(w.raw)), w.deps)).toEqual({
			kind: 'rejected',
			status: 403,
			code: 'API_TOKEN_HOLDER_REFUSED',
			message: expect.any(String)
		});
		expect(w.token.revokedAt).toBeNull();

		holds = true;
		expect((await resolveApiToken(req('/api/v1/projects', bearer(w.raw)), w.deps)).kind).toBe('ok');
	});

	it('checks membership before the policy', async () => {
		const w = world();
		w.member = null;
		const policy = vi.fn(() => true);
		w.deps.mayHoldApiTokens = policy;
		const result = await resolveApiToken(req('/api/v1/projects', bearer(w.raw)), w.deps);
		expect(result).toMatchObject({ kind: 'rejected', status: 401 });
		expect(policy).not.toHaveBeenCalled();
	});
});

describe('resolveApiToken with delegated sessions', () => {
	function delegating(w: World, ok = true) {
		const delegatedSession = {
			status: vi.fn(async () =>
				ok ? { ok: true as const } : { ok: false as const, message: 'bad key' }
			),
			mint: vi.fn(async (userId: string) => `jwt-for-${userId}`)
		};
		w.deps.auth = { ...w.deps.auth, delegatedSession };
		return delegatedSession;
	}

	it('runs the request under a session minted for the owner', async () => {
		const w = world();
		const delegated = delegating(w);
		const result = await resolveApiToken(req('/api/v1/projects', bearer(w.raw)), w.deps);
		expect(result.kind).toBe('ok');
		if (result.kind !== 'ok') return;
		expect(delegated.mint).toHaveBeenCalledWith('u1', { orgId: ORG });
		expect(result.ctx.adapterContext).toEqual({ sessionToken: 'jwt-for-u1' });
		expect(result.ctx.apiScope?.tokenId).toBe('tok-1');
	});

	it('never signs for a disabled owner', async () => {
		const w = world({ user: { disabled: true } });
		const delegated = delegating(w);
		const result = await resolveApiToken(req('/api/v1/projects', bearer(w.raw)), w.deps);
		expect(result).toMatchObject({ kind: 'rejected', status: 401 });
		expect(delegated.mint).not.toHaveBeenCalled();
	});

	it('gives 503 for every key while the signing key is broken', async () => {
		const w = world();
		const delegated = delegating(w, false);
		const lookup = vi.spyOn(w.deps.data.apiTokens!, 'getByTokenHash');
		const result = await resolveApiToken(req('/api/v1/projects', bearer(w.raw)), w.deps);
		expect(result).toMatchObject({ kind: 'rejected', status: 503, code: 'API_TOKENS_UNAVAILABLE' });
		expect(lookup).not.toHaveBeenCalled();
		expect(delegated.mint).not.toHaveBeenCalled();
	});
});
