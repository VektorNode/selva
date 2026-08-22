/**
 * Finding 28 — the slug-collision retry was copied between `/api/v1/projects`
 * and `/api/admin/projects`, had already drifted on three points, and neither
 * copy was tested. It matches a Postgres constraint name with a regex, so a
 * renamed constraint would silently stop the loop retrying and turn a routine
 * collision into a 500.
 */

import { describe, it, expect, vi } from 'vitest';
import {
	ProviderError,
	SYSTEM_CONTEXT,
	type Project,
	type RequestContext
} from '@selvajs/platform';
import { createProjectWithUniqueSlug, type ProjectDraft } from '../create-project.js';

const OPTS = {
	writeCtx: SYSTEM_CONTEXT,
	fallbackSlug: 'project',
	conflictScope: 'this organization'
};

function draft(name: string): ProjectDraft {
	return {
		id: 'p1',
		orgId: 'org1',
		name,
		description: undefined,
		visibility: 'private',
		ownerId: 'u1',
		createdBy: 'u1',
		updatedBy: 'u1',
		autoJoinOnUpload: false
	};
}

function slugConflict() {
	return new ProviderError(
		'duplicate key value violates unique constraint "projects_org_id_slug_key"',
		409
	);
}

/** Refuses the given slugs, accepts anything else. */
function storeRejecting(taken: string[]) {
	const created: Project[] = [];
	return {
		created,
		createProject: vi.fn(async (_ctx: RequestContext, p: Project) => {
			if (taken.includes(p.slug)) throw slugConflict();
			created.push(p);
		})
	};
}

describe('createProjectWithUniqueSlug', () => {
	it('uses the plain slug when it is free', async () => {
		const store = storeRejecting([]);
		const project = await createProjectWithUniqueSlug(store, draft('My Project'), OPTS);
		expect(project.slug).toBe('my-project');
	});

	it('retries past a taken slug rather than failing', async () => {
		const store = storeRejecting(['my-project']);
		const project = await createProjectWithUniqueSlug(store, draft('My Project'), OPTS);
		// The suffix starts at 2 — `-1` would read as the first of a series.
		expect(project.slug).toBe('my-project-2');
		expect(store.createProject).toHaveBeenCalledTimes(2);
	});

	it('keeps retrying across a run of taken slugs', async () => {
		const store = storeRejecting(['my-project', 'my-project-2', 'my-project-3']);
		const project = await createProjectWithUniqueSlug(store, draft('My Project'), OPTS);
		expect(project.slug).toBe('my-project-4');
	});

	it('falls back when the name slugifies to nothing', async () => {
		const store = storeRejecting([]);
		const project = await createProjectWithUniqueSlug(store, draft('★★★'), OPTS);
		expect(project.slug).toBe('project');
	});

	it('maps a duplicate name to 409 without retrying', async () => {
		const store = {
			createProject: vi.fn(async () => {
				throw new ProviderError(
					'duplicate key value violates unique constraint "projects_org_name_unique"',
					409
				);
			})
		};
		// A name clash is the caller's to fix — retrying would only produce a
		// second project with the same name under a different slug.
		await expect(createProjectWithUniqueSlug(store, draft('Taken'), OPTS)).rejects.toMatchObject({
			status: 409
		});
		expect(store.createProject).toHaveBeenCalledTimes(1);
	});

	it('lets an unrelated store error escape instead of burning retries on it', async () => {
		const store = {
			createProject: vi.fn(async () => {
				throw new Error('connection reset');
			})
		};
		await expect(createProjectWithUniqueSlug(store, draft('Whatever'), OPTS)).rejects.toThrow(
			'connection reset'
		);
		expect(store.createProject).toHaveBeenCalledTimes(1);
	});

	it('gives up with a 409 after exhausting its attempts', async () => {
		const store = {
			createProject: vi.fn(async () => {
				throw slugConflict();
			})
		};
		await expect(createProjectWithUniqueSlug(store, draft('Busy'), OPTS)).rejects.toMatchObject({
			status: 409
		});
		expect(store.createProject).toHaveBeenCalledTimes(25);
	});

	it('stamps createdAt and updatedAt identically and leaves deletedAt null', async () => {
		const store = storeRejecting([]);
		const project = await createProjectWithUniqueSlug(store, draft('Fresh'), OPTS);
		expect(project.createdAt).toBe(project.updatedAt);
		expect(project.deletedAt).toBeNull();
	});
});
