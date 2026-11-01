import {
	SYSTEM_CONTEXT,
	definitionPaths,
	orgPaths,
	type IDefinitionStore,
	type IOrgStore,
	type IProjectStore,
	type IStorageProvider,
	type RequestContext
} from '@selvajs/platform';

export interface BlobCleanupStores {
	projects: IProjectStore;
	definitions: IDefinitionStore;
	storage: IStorageProvider;
}

const PAGE_LIMIT = 200;

// As system: the caller is authorized by now, RLS can hide a project's definitions
// from them, and soft-deleted records no longer list, so this runs before the delete.
async function definitionPrefixes(
	definitions: IDefinitionStore,
	projectId: string
): Promise<string[]> {
	const prefixes: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await definitions.listByProject(SYSTEM_CONTEXT, projectId, {
			limit: PAGE_LIMIT,
			cursor,
			includePending: true,
			includeArchived: true
		});
		prefixes.push(...page.items.map((d) => definitionPaths.prefix(d.guid)));
		cursor = page.nextCursor;
	} while (cursor);
	return prefixes;
}

/**
 * Deletes a project and hard-deletes its definitions' blobs. Records go first, for
 * the reason `DefinitionService.delete` gives: a failed wipe leaves orphans no
 * reader can reach, and the reverse leaves live records with their blobs gone.
 */
export async function deleteProjectWithBlobs(
	stores: BlobCleanupStores,
	ctx: RequestContext,
	projectId: string
): Promise<void> {
	const prefixes = await definitionPrefixes(stores.definitions, projectId);
	await stores.projects.deleteProject(ctx, projectId);
	for (const prefix of prefixes) await stores.storage.deletePrefix(prefix);
}

/** Deletes an org and hard-deletes its blobs, branding included: a logo can be personal data. */
export async function deleteOrgWithBlobs(
	stores: BlobCleanupStores & { orgs: IOrgStore },
	ctx: RequestContext,
	orgId: string
): Promise<void> {
	const prefixes = [orgPaths.prefix(orgId)];
	let cursor: string | undefined;
	do {
		const page = await stores.projects.listProjects(SYSTEM_CONTEXT, orgId, {
			limit: PAGE_LIMIT,
			cursor
		});
		for (const project of page.items) {
			prefixes.push(...(await definitionPrefixes(stores.definitions, project.id)));
		}
		cursor = page.nextCursor;
	} while (cursor);

	await stores.orgs.deleteOrg(ctx, orgId);
	for (const prefix of prefixes) await stores.storage.deletePrefix(prefix);
}
