import type { Project, RequestContext } from '@selvajs/platform';
import { ProviderError, slugify } from '@selvajs/platform';
import { apiError, ApiErrorCode } from '../api/errors.js';

const MAX_SLUG_ATTEMPTS = 25;

// Both predicates match a Postgres constraint name inside an error message.
// That is fragile enough that it must exist once: a renamed constraint breaks
// silently — the retry loop stops retrying and a collision surfaces as a 500.
function isSlugConflict(err: unknown): boolean {
	return (
		err instanceof ProviderError &&
		err.statusCode === 409 &&
		/projects_org_id_slug_key/.test(err.message)
	);
}

function isNameConflict(err: unknown): boolean {
	return (
		err instanceof ProviderError &&
		err.statusCode === 409 &&
		/projects_org_name_unique/.test(err.message)
	);
}

/**
 * Fields the caller decides. `slug`, `createdAt`, `updatedAt` and `deletedAt`
 * are derived here so the two create routes cannot disagree about them.
 */
export type ProjectDraft = Omit<Project, 'slug' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

export interface CreateProjectOptions {
	/** Context the store writes under — `SYSTEM_CONTEXT` for the admin route. */
	writeCtx: RequestContext;
	/** Slug stem when the name slugifies to nothing. */
	fallbackSlug: string;
	/** Spliced into the 409 on a duplicate name. */
	conflictScope: string;
}

/**
 * Create a project, retrying on slug collision.
 *
 * The retry is not a nicety: the caller may not be able to *see* a colliding
 * project under RLS, so a pre-flight `getProjectBySlug` cannot decide it — the
 * unique index is the only source of truth.
 *
 * `/api/v1/projects` and `/api/admin/projects` both create projects and both
 * carried a copy of this loop. The copies had already drifted on three points
 * (error re-throw, slug stem, flag validation), which is what makes this the
 * one place in the access surface where duplication caused real divergence.
 */
export async function createProjectWithUniqueSlug(
	store: {
		createProject(ctx: RequestContext, project: Project): Promise<unknown>;
	},
	draft: ProjectDraft,
	{ writeCtx, fallbackSlug, conflictScope }: CreateProjectOptions
): Promise<Project> {
	const baseSlug = slugify(draft.name) || fallbackSlug;
	const now = new Date().toISOString();

	for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
		const project: Project = {
			...draft,
			slug: attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		};

		try {
			await store.createProject(writeCtx, project);
			return project;
		} catch (err) {
			if (isNameConflict(err)) {
				apiError(
					409,
					ApiErrorCode.CONFLICT,
					`A project with that name already exists in ${conflictScope}.`
				);
			}
			// A slug clash is the one error worth another attempt; everything else
			// leaves the loop for the route's error wrapper to map.
			if (!isSlugConflict(err)) throw err;
		}
	}

	apiError(
		409,
		ApiErrorCode.CONFLICT,
		'Could not pick a unique project slug after several attempts.'
	);
}
