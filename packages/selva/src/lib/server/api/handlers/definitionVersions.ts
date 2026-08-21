/**
 * Version handlers: list, upload, read, delete, and a version's cached schema.
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
	parseParam,
	requireUpload
} from '@selvajs/server/api';
import type { ApiHandler } from '@selvajs/server/api';
import { GuidSchema } from '@selvajs/platform/definitions';
import { requireEditableDefinition } from '../../access.server';
import { GH_EXTENSIONS } from '@selvajs/platform';
import { resolveServerForOrg } from '../../compute/resolve.server';
import { fetchSchemaFromCompute } from '@selvajs/server/definitions';
import { getVisibleDefinition, loadVisibleVersion } from '../../definitions/visibility.server';
import { parseListOptions } from '../../pagination.server';
import { requireCaller } from '../callers';
import { definitionService } from './services';

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

/** Upload a new version. Advances `draft`; `live` is unchanged until publish. */
export const uploadVersion: ApiHandler = async (req) => {
	const guid = parseParam(req.params.guid, GuidSchema, 'GUID');

	const form = await req.request.formData();
	const { file, extension } = requireUpload(form, 'file', {
		maxBytes: req.deps.uploadLimits.maxDefinitionFileSize,
		extensions: GH_EXTENSIONS,
		label: 'Grasshopper (.gh or .ghx) file'
	});
	const changeNote = formText(form, 'changeNote', { maxLength: 1000 });

	const { ctx, record, project } = await requireEditableDefinition(req, guid);
	const data = new Uint8Array(await file.arrayBuffer());

	// Validate-and-cache gate: extract the schema from compute BEFORE any
	// write, so a failure rejects the upload with nothing persisted.
	// `project` comes from the guard — no re-fetch.
	const server = await resolveServerForOrg(ctx, project?.orgId ?? null, req.deps.computeServer, {
		definitionPin: record.computeServerId ?? null
	});
	const schema = await fetchSchemaFromCompute(data, server);

	const version = await definitionService(req.deps).uploadVersion(
		ctx,
		guid,
		data,
		extension.slice(1) as 'gh' | 'ghx',
		file.name,
		schema,
		changeNote
	);
	return created({ version });
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
