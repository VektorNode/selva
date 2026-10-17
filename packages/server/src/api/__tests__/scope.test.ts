import { describe, it, expect } from 'vitest';
import { NoopLogger, narrowApiTokenContext, type RequestContext } from '@selvajs/platform';
import { runHandler, type RunHandlerOptions } from '../respond.js';
import { definitionScopeTarget, projectScopeTarget } from '../scope.js';
import type { ApiHandler, ApiRequest } from '../types.js';
import type { SelvaDeps } from '../deps.js';

const ORG = 'org-a';
const ok: ApiHandler = async () => ({ body: { ok: true } });

function session(): RequestContext {
	return { userId: 'u1', actingOrgId: ORG, platformPermissions: [], orgPermissions: [] };
}

function keyed(...scopes: string[]): RequestContext {
	return narrowApiTokenContext(session(), { id: 't1', orgId: ORG, scopes });
}

function request(
	ctx: RequestContext,
	method: string,
	params: Record<string, string> = {},
	deps: Partial<SelvaDeps> = {}
): ApiRequest {
	const url = new URL('http://selva.test/api/v1/x');
	return {
		ctx,
		log: new NoopLogger(),
		params,
		url,
		request: new Request(url, { method }),
		deps: deps as SelvaDeps
	};
}

async function run(req: ApiRequest, opts: Partial<RunHandlerOptions> = {}) {
	const res = await runHandler(ok, req, { fallback: 'x', ...opts });
	return { status: res.status, body: await res.json() };
}

describe('runHandler scope check', () => {
	it('lets a browser session through on any method', async () => {
		expect((await run(request(session(), 'DELETE'))).status).toBe(200);
	});

	it('refuses a write with a read key and names the scope it needed', async () => {
		const { status, body } = await run(request(keyed('read:all'), 'POST'));
		expect(status).toBe(403);
		expect(body.code).toBe('FORBIDDEN');
		expect(body.details).toEqual({ requiredScope: `write:org:${ORG}` });
	});

	it('lets a read key GET and a write key POST', async () => {
		expect((await run(request(keyed('read:all'), 'GET'))).status).toBe(200);
		expect((await run(request(keyed('write:all'), 'POST'))).status).toBe(200);
	});

	it('uses the declared action over the method', async () => {
		const solveRoute = { action: 'solve' as const };
		expect((await run(request(keyed('write:all'), 'POST'), solveRoute)).status).toBe(403);
		expect((await run(request(keyed('solve:all'), 'POST'), solveRoute)).status).toBe(200);
	});

	it('refuses a project key on a route that names no project', async () => {
		expect((await run(request(keyed('read:project:p1'), 'GET'))).status).toBe(403);
	});

	it('lets a project key reach its own project and nothing else', async () => {
		const opts = { scopeTarget: projectScopeTarget('id') };
		const ctx = keyed('read:project:p1');
		expect((await run(request(ctx, 'GET', { id: 'p1' }), opts)).status).toBe(200);
		const other = await run(request(ctx, 'GET', { id: 'p2' }), opts);
		expect(other.status).toBe(403);
		expect(other.body.details).toEqual({ requiredScope: 'read:project:p2' });
	});

	const definitionMeta = {
		get: async (_ctx: unknown, guid: string) =>
			({ d1: { projectId: 'p1' }, d2: { projectId: 'p2' }, d3: { projectId: 'p3' } })[guid] ?? null
	} as unknown as SelvaDeps['definitionMeta'];
	const projects = {
		getProject: async (_ctx: unknown, id: string) =>
			({ p1: { id, orgId: ORG }, p2: { id, orgId: ORG }, p3: { id, orgId: 'org-b' } })[id] ?? null
	} as unknown as SelvaDeps['projects'];
	const definitionOpts = { scopeTarget: definitionScopeTarget('guid') };

	it('lets a project key reach a definition inside its project', async () => {
		const ctx = keyed('read:project:p1');
		const deps = { definitionMeta, projects };
		expect((await run(request(ctx, 'GET', { guid: 'd1' }, deps), definitionOpts)).status).toBe(200);
		expect((await run(request(ctx, 'GET', { guid: 'd2' }, deps), definitionOpts)).status).toBe(403);
	});

	it('refuses a definition in another org exactly like a missing one', async () => {
		const ctx = keyed('read:project:p1');
		const deps = { definitionMeta, projects };
		const foreign = await run(request(ctx, 'GET', { guid: 'd3' }, deps), definitionOpts);
		const missing = await run(request(ctx, 'GET', { guid: 'nope' }, deps), definitionOpts);
		expect(foreign.status).toBe(403);
		expect(foreign.body.details).toEqual({ requiredScope: 'read:definition:d3' });
		expect(missing.body.details).toEqual({ requiredScope: 'read:definition:nope' });
	});

	it('never runs the handler when the scope check fails', async () => {
		let ran = false;
		const handler: ApiHandler = async () => {
			ran = true;
			return {};
		};
		await runHandler(handler, request(keyed('read:all'), 'DELETE'), { fallback: 'x' });
		expect(ran).toBe(false);
	});
});
