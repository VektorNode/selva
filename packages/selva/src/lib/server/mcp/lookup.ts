import type { UntypedApi } from '@selvajs/mcp';
import { GuidSchema, type DefinitionListItem } from '@selvajs/platform';
import { z } from 'zod';

export type DefinitionItem = Pick<
	DefinitionListItem,
	'guid' | 'displayName' | 'description' | 'status' | 'projectId' | 'liveVersionId'
>;

export interface VersionSummary {
	id: string;
	versionNumber: number;
	uploadedAt?: string;
	changeNote?: string | null;
}

export interface DefinitionRecord {
	guid: string;
	displayName: string;
	description?: string | null;
	category?: string | null;
	tags?: string[] | null;
	status: string;
	projectId: string;
	coverImage?: string | null;
	liveVersion: VersionSummary | null;
	draftVersion: VersionSummary | null;
}

export interface ProjectItem {
	id: string;
	name: string;
	description?: string;
	visibility?: string;
}

export interface Page<T> {
	items: T[];
	nextCursor?: string;
}

// Enough for any library a person names things in by hand; past it, use an id.
const NAME_LOOKUP_PAGES = 5;

export const definitionArg = z
	.string()
	.describe('A guid from selva_list_definitions, or the exact display name.');

export const projectArg = z
	.string()
	.describe('A project id from selva_list_projects, or the exact project name.');

export const versionArg = z
	.string()
	.optional()
	.describe(
		'`live` (the default), `draft` for the newest upload that is not live yet, or a version id ' +
			'from selva_list_versions.'
	);

async function findByName<T>(
	api: UntypedApi,
	operationId: string,
	signal: AbortSignal,
	matches: (item: T) => boolean
): Promise<T[]> {
	const found: T[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < NAME_LOOKUP_PAGES; page++) {
		const res = (await api.call(operationId, {
			query: { limit: 100, cursor },
			signal
		})) as Page<T>;
		found.push(...res.items.filter(matches));
		cursor = res.nextCursor;
		if (!cursor) break;
	}
	return found;
}

export async function resolveDefinition(
	api: UntypedApi,
	definition: string,
	signal: AbortSignal
): Promise<string> {
	const guid = GuidSchema.safeParse(definition);
	if (guid.success) return guid.data;
	const wanted = definition.trim().toLowerCase();
	const matches = await findByName<DefinitionItem>(
		api,
		'getDefinitions',
		signal,
		(d) => d.displayName.trim().toLowerCase() === wanted
	);
	if (matches.length === 1) return matches[0].guid;
	if (!matches.length) {
		throw new Error(
			`No definition is named "${definition}". Call selva_list_definitions and pass a guid.`
		);
	}
	const lines = matches.map((d) => `- ${d.displayName} (guid ${d.guid})`);
	throw new Error(
		[`${matches.length} definitions are named "${definition}"; pass one guid:`, ...lines].join('\n')
	);
}

export async function resolveProject(
	api: UntypedApi,
	project: string,
	signal: AbortSignal
): Promise<ProjectItem> {
	const wanted = project.trim().toLowerCase();
	const matches = await findByName<ProjectItem>(
		api,
		'getProjects',
		signal,
		(p) => p.id.toLowerCase() === wanted || p.name.trim().toLowerCase() === wanted
	);
	const byId = matches.find((p) => p.id.toLowerCase() === wanted);
	if (byId) return byId;
	if (matches.length === 1) return matches[0];
	if (!matches.length) {
		throw new Error(`No project is named "${project}". Call selva_list_projects and pass an id.`);
	}
	const lines = matches.map((p) => `- ${p.name} (id ${p.id})`);
	throw new Error(
		[`${matches.length} projects are named "${project}"; pass one id:`, ...lines].join('\n')
	);
}

export function getRecord(api: UntypedApi, guid: string, signal: AbortSignal) {
	return api.call('getDefinitionsByGuid', {
		params: { guid },
		signal
	}) as Promise<DefinitionRecord>;
}

/** `live` and `draft` by the record's pointers; anything else is taken as a version id. */
export function pickVersion(record: DefinitionRecord, version = 'live'): VersionSummary {
	if (version === 'live') {
		if (!record.liveVersion) {
			throw new Error(
				`${record.displayName} has no live version. Pass version: 'draft' to use the newest upload.`
			);
		}
		return record.liveVersion;
	}
	if (version === 'draft') {
		const draft = record.draftVersion ?? record.liveVersion;
		if (!draft) throw new Error(`${record.displayName} has no uploaded version.`);
		return draft;
	}
	const known = [record.liveVersion, record.draftVersion].find((v) => v?.id === version);
	return known ?? { id: version, versionNumber: 0 };
}

export function versionLabel(record: DefinitionRecord, v: VersionSummary): string {
	const number = v.versionNumber ? `version ${v.versionNumber}` : `version ${v.id}`;
	if (v.id === record.liveVersion?.id) return `${number} (live)`;
	if (v.id === record.draftVersion?.id) return `${number} (uploaded, not live)`;
	return number;
}

// ============================================================================
// Live, draft and listed: three things the record keeps apart
// ============================================================================

/**
 * `status` only says whether the library lists the definition; what solves is the live version.
 * A fresh upload is both live and `draft`, so models read `draft` as "can't run" unless told.
 */
export function channelText(r: DefinitionRecord): string {
	const parts = [
		r.liveVersion
			? `Version ${r.liveVersion.versionNumber} is live: solves run it.`
			: 'No version is live; only `version: draft` solves it.'
	];
	if (r.draftVersion && r.draftVersion.id !== r.liveVersion?.id) {
		parts.push(
			`Version ${r.draftVersion.versionNumber} is uploaded but not live: solve it with ` +
				"`version: 'draft'`, make it live with selva_publish_definition."
		);
	}
	parts.push(listedText(r.status));
	return parts.join(' ');
}

export function listedText(status: string): string {
	if (status === 'published') return 'The library lists it.';
	if (status === 'archived') return 'It is archived: the library hides it.';
	return 'The library does not list it until it is published; that does not stop solves.';
}
