/**
 * The SvelteKit binding is where a mounted handler's failures become statuses.
 *
 * The case that matters is `HttpError`: the nine `requireCanX` guards throw
 * SvelteKit's `error()`, and must keep doing so because page loads share them.
 * `runHandler` only recognizes `ApiError`, so without the `isHttpError` branch
 * in `mapAppError` every guard rejection becomes a 500 instead of a 403 — a
 * downgrade that produces no type error and no failure in any test that does
 * not assert the status. These tests assert it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { apiError, ApiErrorCode, type ApiHandler } from '@selvajs/server/api';
import { mount } from '../sveltekit.js';
import { freshProviders, seedAcme, actAs, type TestProviders } from '../../__tests__/fixtures.js';

let tp: TestProviders;

afterEach(async () => {
	await tp?.cleanup();
});

/** A RequestEvent carrying only the fields `toApiRequest` reads. */
async function eventFor(
	userId: string,
	init: { method?: string; body?: unknown; url?: string } = {}
): Promise<RequestEvent> {
	const { user, ctx, profile, providers } = await actAs(tp, userId);
	const url = new URL(init.url ?? 'http://localhost/api/v1/projects');
	const request = new Request(url, {
		method: init.method ?? 'GET',
		...(init.body === undefined
			? {}
			: { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } })
	});
	return {
		locals: { user, ctx, profile, providers, log: silentLog },
		params: {},
		url,
		request
	} as unknown as RequestEvent;
}

// The 500 branch logs through `req.log`; a real logger would print a stack per
// test run. Assertions are on the response, not on what was logged.
const silentLog = {
	error: () => {},
	warn: () => {},
	info: () => {},
	debug: () => {},
	child: () => silentLog
};

describe('mount — error mapping', () => {
	it('maps a guard’s HttpError to its own status, not 500', async () => {
		tp = await freshProviders();
		const { alice } = await seedAcme(tp);

		const handler: ApiHandler = async () => {
			throw error(403, { message: 'Nope', code: ApiErrorCode.FORBIDDEN });
		};
		const res = await mount('Failed', handler)(await eventFor(alice.id));

		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ message: 'Nope', code: ApiErrorCode.FORBIDDEN });
	});

	it('maps a bare string HttpError — what the access guards actually throw', async () => {
		tp = await freshProviders();
		const { alice } = await seedAcme(tp);

		// `requireCanCreateProject` throws exactly this shape: no code.
		const handler: ApiHandler = async () => {
			throw error(403, 'You do not have permission to create projects in this org.');
		};
		const res = await mount('Failed', handler)(await eventFor(alice.id));

		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({
			message: 'You do not have permission to create projects in this org.',
			code: ApiErrorCode.FORBIDDEN
		});
	});

	it('still passes ApiError through', async () => {
		tp = await freshProviders();
		const { alice } = await seedAcme(tp);

		const handler: ApiHandler = async () => {
			apiError(409, ApiErrorCode.CONFLICT, 'Taken');
		};
		const res = await mount('Failed', handler)(await eventFor(alice.id));

		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ message: 'Taken', code: ApiErrorCode.CONFLICT });
	});

	it('still falls back to 500 for an unrecognized error', async () => {
		tp = await freshProviders();
		const { alice } = await seedAcme(tp);

		const handler: ApiHandler = async () => {
			throw new Error('boom');
		};
		const res = await mount('Failed to do the thing', handler)(await eventFor(alice.id));

		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({
			message: 'Failed to do the thing',
			code: ApiErrorCode.INTERNAL
		});
	});

	it('preserves a validation error’s per-field detail', async () => {
		tp = await freshProviders();
		const { alice } = await seedAcme(tp);

		const handler: ApiHandler = async () => {
			apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Bad name', { name: 'Required' });
		};
		const res = await mount('Failed', handler)(await eventFor(alice.id));

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({
			message: 'Bad name',
			code: ApiErrorCode.VALIDATION_FAILED,
			fields: { name: 'Required' }
		});
	});
});

describe('POST /api/v1/projects through the binding', () => {
	it('creates a project for a member of the acting org', async () => {
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		const { createProject } = await import('../handlers/projects.js');

		const res = await mount(
			'Failed to create project',
			createProject
		)(
			await eventFor(alice.id, {
				method: 'POST',
				body: { name: 'Fresh Project', visibility: 'private' }
			})
		);

		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body).toMatchObject({ name: 'Fresh Project', orgId: acme.id, ownerId: alice.id });
		expect(body.slug).toBe('fresh-project');
	});

	it('rejects platform visibility from a non-platform-admin with 403, not 500', async () => {
		tp = await freshProviders();
		const { alice } = await seedAcme(tp);
		const { createProject } = await import('../handlers/projects.js');

		const res = await mount(
			'Failed to create project',
			createProject
		)(
			await eventFor(alice.id, {
				method: 'POST',
				body: { name: 'Sneaky', visibility: 'platform' }
			})
		);

		expect(res.status).toBe(403);
		expect((await res.json()).code).toBe(ApiErrorCode.FORBIDDEN);
	});

	it('rejects a malformed body with 400 and field detail', async () => {
		tp = await freshProviders();
		const { alice } = await seedAcme(tp);
		const { createProject } = await import('../handlers/projects.js');

		const res = await mount(
			'Failed to create project',
			createProject
		)(await eventFor(alice.id, { method: 'POST', body: { visibility: 'private' } }));

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.code).toBe(ApiErrorCode.VALIDATION_FAILED);
		expect(body.fields).toHaveProperty('name');
	});

	it('writes through the injected deps, not the module-global provider', async () => {
		tp = await freshProviders();
		const { alice } = await seedAcme(tp);
		const { createProject } = await import('../handlers/projects.js');

		const event = await eventFor(alice.id, {
			method: 'POST',
			body: { name: 'Injected', visibility: 'private' }
		});
		let sawWrite = false;
		const realProjects = event.locals.providers.data.projects;
		event.locals.providers = {
			...event.locals.providers,
			data: {
				...event.locals.providers.data,
				projects: {
					...realProjects,
					createProject: (ctx: never, project: never) => {
						sawWrite = true;
						return realProjects.createProject(ctx, project);
					}
				}
			}
		} as typeof event.locals.providers;

		const res = await mount('Failed to create project', createProject)(event);

		expect(res.status).toBe(201);
		// Fails if the handler reaches for `getProjectProvider()` instead of
		// `req.deps.projects` — the whole point of injection.
		expect(sawWrite).toBe(true);
	});
});
