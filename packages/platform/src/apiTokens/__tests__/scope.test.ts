import { describe, it, expect } from 'vitest';
import type { RequestContext } from '../../context.js';
import { narrowApiTokenContext, scopeAllows } from '../scope.js';
import { describeApiScope, formatApiScope, parseApiScope } from '../types.js';

const ORG = 'org-a';
const EXPIRES = '2099-01-01T00:00:00.000Z';

function session(): RequestContext {
	return {
		userId: 'u1',
		actingOrgId: ORG,
		platformPermissions: ['instance_admin', 'manage_api_tokens'],
		orgPermissions: ['manage_projects']
	};
}

function keyed(...scopes: string[]): RequestContext {
	return narrowApiTokenContext(session(), { id: 't1', orgId: ORG, scopes, expiresAt: EXPIRES });
}

describe('parseApiScope', () => {
	it.each(['read:all', 'write:org:org-a', 'solve:project:p1', 'read:definition:abc-123'])(
		'round-trips %s',
		(s) => {
			expect(formatApiScope(parseApiScope(s)!)).toBe(s);
		}
	);

	it.each(['admin:all', 'read', 'read:org', 'read:all:x', 'read:org:a:b', 'read:team:t1', ''])(
		'rejects %s',
		(s) => {
			expect(parseApiScope(s)).toBeNull();
		}
	);
});

describe('scopeAllows', () => {
	it('passes every request without a token', () => {
		expect(scopeAllows(session(), 'write')).toBe(true);
		expect(scopeAllows(session(), 'solve', { projectId: 'p9' })).toBe(true);
	});

	it('write and solve include read, but not each other', () => {
		expect(scopeAllows(keyed('write:all'), 'read')).toBe(true);
		expect(scopeAllows(keyed('solve:all'), 'read')).toBe(true);
		expect(scopeAllows(keyed('write:all'), 'solve')).toBe(false);
		expect(scopeAllows(keyed('solve:all'), 'write')).toBe(false);
		expect(scopeAllows(keyed('read:all'), 'write')).toBe(false);
	});

	it('an org scope covers only the acting org', () => {
		expect(scopeAllows(keyed('read:org:org-a'), 'read')).toBe(true);
		expect(scopeAllows(keyed('read:org:org-b'), 'read')).toBe(false);
	});

	it('an org-level check refuses project and definition keys', () => {
		expect(scopeAllows(keyed('write:project:p1'), 'read')).toBe(false);
		expect(scopeAllows(keyed('write:definition:d1'), 'read')).toBe(false);
	});

	it('a project key covers that project and the definitions in it', () => {
		const ctx = keyed('read:project:p1');
		expect(scopeAllows(ctx, 'read', { projectId: 'p1' })).toBe(true);
		expect(scopeAllows(ctx, 'read', { projectId: 'p1', definitionId: 'd1' })).toBe(true);
		expect(scopeAllows(ctx, 'read', { projectId: 'p2' })).toBe(false);
	});

	it('a definition key covers only that definition', () => {
		const ctx = keyed('solve:definition:d1');
		expect(scopeAllows(ctx, 'solve', { projectId: 'p1', definitionId: 'd1' })).toBe(true);
		expect(scopeAllows(ctx, 'solve', { projectId: 'p1', definitionId: 'd2' })).toBe(false);
		expect(scopeAllows(ctx, 'solve', { projectId: 'p1' })).toBe(false);
	});

	it('any one matching scope is enough', () => {
		const ctx = keyed('read:all', 'solve:project:p1');
		expect(scopeAllows(ctx, 'solve', { projectId: 'p1' })).toBe(true);
		expect(scopeAllows(ctx, 'solve', { projectId: 'p2' })).toBe(false);
	});
});

describe('narrowApiTokenContext', () => {
	it('drops platform permissions and keeps org permissions', () => {
		const ctx = keyed('write:all');
		expect(ctx.platformPermissions).toEqual([]);
		expect(ctx.orgPermissions).toEqual(['manage_projects']);
		expect(ctx.apiScope?.tokenId).toBe('t1');
	});

	it('drops scopes it cannot parse, so they grant nothing', () => {
		const ctx = keyed('admin:all');
		expect(ctx.apiScope?.scopes).toEqual([]);
		expect(scopeAllows(ctx, 'read')).toBe(false);
	});

	it('refuses a context acting in another org', () => {
		expect(() =>
			narrowApiTokenContext(session(), {
				id: 't1',
				orgId: 'org-b',
				scopes: ['read:all'],
				expiresAt: EXPIRES
			})
		).toThrow();
	});

	it('carries the key’s expiry', () => {
		expect(keyed('read:all').apiScope?.expiresAt).toBe(EXPIRES);
	});
});

describe('upload', () => {
	it.each(['upload:all', 'upload:project:p1', 'upload:definition:d1'])('round-trips %s', (s) => {
		expect(formatApiScope(parseApiScope(s)!)).toBe(s);
	});

	it('includes read and nothing else', () => {
		const ctx = keyed('upload:all');
		expect(scopeAllows(ctx, 'upload')).toBe(true);
		expect(scopeAllows(ctx, 'read')).toBe(true);
		expect(scopeAllows(ctx, 'write')).toBe(false);
		expect(scopeAllows(ctx, 'solve')).toBe(false);
	});

	it('is included in write, but not in read or solve', () => {
		expect(scopeAllows(keyed('write:all'), 'upload')).toBe(true);
		expect(scopeAllows(keyed('read:all'), 'upload')).toBe(false);
		expect(scopeAllows(keyed('solve:all'), 'upload')).toBe(false);
	});

	it('follows the resource like any other action', () => {
		const ctx = keyed('upload:project:p1');
		expect(scopeAllows(ctx, 'upload', { projectId: 'p1', definitionId: 'd1' })).toBe(true);
		expect(scopeAllows(ctx, 'upload', { projectId: 'p2' })).toBe(false);
		expect(scopeAllows(ctx, 'upload')).toBe(false);
	});

	it('is described in plain words', () => {
		expect(describeApiScope('upload:all')).toBe(
			'Read and upload definitions to everything in the org'
		);
	});
});
