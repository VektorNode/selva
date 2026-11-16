/**
 * Version handlers: list, upload and its dry-run check, read, delete, a version's cached schema,
 * and what it changed.
 *
 * Reads resolve through `getVisibleDefinition` / `loadVisibleVersion`, which
 * return `null` rather than throwing, so an invisible definition answers 404.
 * A 403 anywhere here would confirm a guid exists across a tenant boundary.
 */

import {
	apiError,
	ApiErrorCode,
	collection,
	created,
	formText,
	noContent,
	parseListOptions,
	parseParam,
	readForm,
	requireCaller,
	requireUpload
} from '../api/index.js';
import type { ApiHandler, ApiRequest } from '../api/index.js';
import { GuidSchema, MAX_CHANGE_NOTE_LENGTH } from '@selvajs/platform/definitions';
import { requireEditableDefinition } from '../access/index.js';
import {
	GH_EXTENSIONS,
	type DefinitionRecord,
	type DefinitionVersion,
	type RequestContext
} from '@selvajs/platform';
import { diffSchemas, type SchemaDiff, type UISchema } from '@selvajs/schemas';
import { resolveServerForOrg } from '../compute/index.js';
import {
	extractSchemaForUpload,
	getVisibleDefinition,
	loadVisibleVersion
} from '../definitions/index.js';
import { definitionService } from './services.js';

export const listVersions: ApiHandler = async (req) => {
	const guid = parseParam(req.params.guid, GuidSchema, 'GUID');
	const { ctx } = requireCaller(req);

	// Resolve through `getVisibleDefinition` like the sibling routes, which
	// answers 404 for a guid the caller cannot see. A 403 here would confirm
	// the definition exists and turn this into a cross-tenant existence oracle.
	const def = await getVisibleDefinition(ctx, guid, req.deps);
	if (!def) apiError(404, ApiErrorCode.NOT_FOUND, 'Definition not found');

	return collection(
		await req.deps.definitionMeta.listVersions(ctx, guid, parseListOptions(req.url))
	);
};

// ============================================================================
// Upload, and its dry run
// ============================================================================

interface VersionRef {
	id: string;
	versionNumber: number;
}

const refOf = (v: DefinitionVersion | null): VersionRef | null =>
	v ? { id: v.id, versionNumber: v.versionNumber } : null;

/** Null without a base, or when the base predates schema caching. */
const changesFrom = (
	base: DefinitionVersion | null,
	schema: UISchema | undefined
): SchemaDiff | null => (base?.schema && schema ? diffSchemas(base.schema, schema) : null);

/** The version an upload follows: the draft it replaces, else the live one. */
async function loadBase(
	req: ApiRequest,
	ctx: RequestContext,
	record: DefinitionRecord
): Promise<DefinitionVersion | null> {
	const id = record.draftVersionId ?? record.liveVersionId;
	return id ? req.deps.definitionMeta.getVersion(ctx, id) : null;
}

/**
 * The uploaded file, guarded and with its schema extracted on the server this definition solves
 * on. Extraction is the validity gate: a file without a usable schema throws before any write.
 */
async function readVersionUpload(req: ApiRequest, guid: string) {
	const form = await readForm(req.request);
	const { file, extension } = requireUpload(form, 'file', {
		maxBytes: req.deps.uploadLimits.maxDefinitionFileSize,
		extensions: GH_EXTENSIONS,
		label: 'Grasshopper (.gh or .ghx) file'
	});
	// Multipart encoding turns every newline into CRLF; notes are stored with LF.
	const changeNote = formText(form, 'changeNote')?.replace(/\r\n?/g, '\n');
	if (changeNote && changeNote.length > MAX_CHANGE_NOTE_LENGTH) {
		apiError(
			400,
			ApiErrorCode.VALIDATION_FAILED,
			`Change notes are limited to ${MAX_CHANGE_NOTE_LENGTH.toLocaleString('en')} characters`
		);
	}

	const { ctx, record, project } = await requireEditableDefinition(req, guid);
	const data = new Uint8Array(await file.arrayBuffer());
	const server = await resolveServerForOrg(ctx, project?.orgId ?? null, req.deps.computeServer, {
		definitionPin: record.computeServerId ?? null
	});
	const schema = await extractSchemaForUpload(data, server);
	return { ctx, record, file, extension, data, schema, changeNote };
}

/**
 * What uploading this file would change, without uploading it: the same checks as an upload,
 * then a diff against the version it would follow. Writes nothing.
 */
export const checkVersion: ApiHandler = async (req) => {
	const guid = parseParam(req.params.guid, GuidSchema, 'GUID');
	const { ctx, record, schema } = await readVersionUpload(req, guid);
	const base = await loadBase(req, ctx, record);
	return {
		body: {
			schema: {
				name: schema.name,
				inputs: schema.inputs?.length ?? 0,
				outputs: schema.outputs?.length ?? 0
			},
			base: refOf(base),
			changes: changesFrom(base, schema)
		}
	};
};

/** Upload a new version. Advances `draft`; `live` is unchanged until publish. */
export const uploadVersion: ApiHandler = async (req) => {
	const guid = parseParam(req.params.guid, GuidSchema, 'GUID');
	const { ctx, record, file, extension, data, schema, changeNote } = await readVersionUpload(
		req,
		guid
	);
	// Before the upload: it moves the draft pointer to the new version.
	const base = await loadBase(req, ctx, record);

	const version = await definitionService(req.deps).uploadVersion(
		ctx,
		guid,
		data,
		extension.slice(1) as 'gh' | 'ghx',
		file.name,
		schema,
		changeNote
	);
	return created({ version, base: refOf(base), changes: changesFrom(base, schema) });
};

/**
 * What a version changed, from the schemas cached at upload. `?against=` names the version to
 * compare with; without it, the one numbered just before. The first version has no base.
 */
export const getVersionChanges: ApiHandler = async (req) => {
	const guid = parseParam(req.params.guid, GuidSchema, 'GUID');
	const versionId = parseParam(req.params.versionId, GuidSchema, 'version ID');
	const { ctx } = requireCaller(req);

	const version = await loadVisibleVersion(ctx, guid, versionId, req.deps);
	if (!version) apiError(404, ApiErrorCode.NOT_FOUND, 'Version not found');

	const against = req.url.searchParams.get('against');
	let base: DefinitionVersion | null = null;
	if (against) {
		const againstId = parseParam(against, GuidSchema, 'against');
		base = await loadVisibleVersion(ctx, guid, againstId, req.deps);
		if (!base) apiError(404, ApiErrorCode.NOT_FOUND, 'Version to compare against not found');
	} else {
		// Newest first, so the first lower number is the one just before.
		const all = (await req.deps.definitionMeta.listVersionsFor(ctx, [guid])).get(guid) ?? [];
		const previous = all.find((v) => v.versionNumber < version.versionNumber);
		base = previous ? await req.deps.definitionMeta.getVersion(ctx, previous.id) : null;
	}

	return { body: { base: refOf(base), changes: changesFrom(base, version.schema) } };
};

/**
 * Version metadata. `schema` is excluded and served by the `/schema`
 * sub-resource, so a version read never carries a several-hundred-KB blob.
 */
export const getVersion: ApiHandler = async (req) => {
	const guid = parseParam(req.params.guid, GuidSchema, 'GUID');
	const versionId = parseParam(req.params.versionId, GuidSchema, 'version ID');
	const { ctx } = requireCaller(req);

	const version = await loadVisibleVersion(ctx, guid, versionId, req.deps);
	if (!version) apiError(404, ApiErrorCode.NOT_FOUND, 'Version not found');
	const { schema: _schema, ...rest } = version;
	return { body: rest };
};

/**
 * Delete an old version. The store throws 409 if the version is currently
 * referenced by `liveVersionId` or `draftVersionId` — repoint first.
 */
export const deleteVersion: ApiHandler = async (req) => {
	const guid = parseParam(req.params.guid, GuidSchema, 'GUID');
	const versionId = parseParam(req.params.versionId, GuidSchema, 'version ID');

	const { ctx } = await requireEditableDefinition(req, guid);
	await definitionService(req.deps).deleteVersion(ctx, guid, versionId);
	return noContent();
};

/**
 * The UI schema cached on this version at upload. Reads what is stored — no
 * Rhino.Compute round-trip, unlike the pre-upload `POST /api/v1/compute/schema`.
 *
 * Schemas belong to a version, so this is the canonical location;
 * `/definitions/{guid}/schema` is an alias for the live one.
 */
export const getVersionSchema: ApiHandler = async (req) => {
	const guid = parseParam(req.params.guid, GuidSchema, 'GUID');
	const versionId = parseParam(req.params.versionId, GuidSchema, 'version ID');
	const { ctx } = requireCaller(req);

	const version = await loadVisibleVersion(ctx, guid, versionId, req.deps);
	if (!version) apiError(404, ApiErrorCode.NOT_FOUND, 'Version not found');
	// A pre-caching version can still lack a schema (lazy backfill bridge) —
	// that is a missing sub-resource, not an error.
	if (!version.schema) apiError(404, ApiErrorCode.NOT_FOUND, 'No schema cached for this version');
	return { body: version.schema };
};
