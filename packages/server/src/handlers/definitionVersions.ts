/**
 * Version handlers: list, upload and its dry-run check, read, delete, a version's cached schema,
 * what it changed, its inventory and its scripts' code.
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
import {
	diffInventories,
	diffLines,
	diffSchemas,
	inventoryWarnings,
	summarizeInventory,
	type DocumentInventory,
	type InventoryDiff,
	type InventorySummary,
	type InventoryWarning,
	type SchemaDiff,
	type UISchema
} from '@selvajs/schemas';
import { resolveServerForOrg } from '../compute/index.js';
import {
	extractSchemaForUpload,
	fetchExtraction,
	fetchScriptSources,
	getVisibleDefinition,
	loadVisibleDefinition,
	loadVisibleVersion,
	mayUploadToDefinition
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

/**
 * Null without a base, or when the base predates schema caching. With `defaultsPending` the new
 * file's saved values are unknown, not removed, so its defaults compare as the base's.
 */
function changesFrom(
	base: DefinitionVersion | null,
	schema: UISchema | undefined,
	defaultsPending = false
): SchemaDiff | null {
	if (!base?.schema || !schema) return null;
	return diffSchemas(base.schema, defaultsPending ? withDefaultsOf(schema, base.schema) : schema);
}

function withDefaultsOf(schema: UISchema, base: UISchema): UISchema {
	const defaults = new Map(base.inputs.map((input) => [input.id, input.default]));
	return {
		...schema,
		inputs: schema.inputs.map((input) =>
			defaults.has(input.id) ? { ...input, default: defaults.get(input.id) } : input
		)
	};
}

// ============================================================================
// Inventory: what the file holds beyond its form
// ============================================================================

/**
 * The inventory side of a check, upload or compare. `null` when the newer file has none (a
 * server or plugin that predates it). `diff` is null without a base, or when `missing` says the
 * base has no inventory yet.
 */
interface InventoryReport {
	summary: InventorySummary;
	warnings: InventoryWarning[];
	/** Each plugin the file was saved with, beside what the server had loaded when it read the file. */
	plugins: PluginRequirement[];
	/** The Selva plugin version on the server that read the file. */
	extractedWith: string;
	diff: InventoryDiff | null;
	missing: 'base' | null;
}

interface PluginRequirement {
	name: string;
	version: string;
	/** Null when the server had not loaded it. */
	serverVersion: string | null;
}

function pluginRequirements(inventory: DocumentInventory): PluginRequirement[] {
	return inventory.libraries
		.filter((l) => !l.core)
		.map((l) => ({ name: l.name, version: l.version, serverVersion: l.serverVersion ?? null }));
}

function inventoryReport(
	inventory: DocumentInventory | null | undefined,
	schema: UISchema | undefined,
	base: DefinitionVersion | null
): InventoryReport | null {
	if (!inventory) return null;
	const formIds = [...(schema?.inputs ?? []), ...(base?.schema?.inputs ?? [])].map((i) => i.id);
	return {
		summary: summarizeInventory(inventory),
		warnings: inventoryWarnings(inventory),
		plugins: pluginRequirements(inventory),
		extractedWith: inventory.extractedWith,
		diff: base?.inventory ? diffInventories(base.inventory, inventory, { formIds }) : null,
		missing: base && !base.inventory ? 'base' : null
	};
}

/**
 * A plugin the server lacks, or a component its installed release lacks, makes every solve drop
 * those components and succeed with outputs missing, so it blocks the upload unless the caller
 * accepts that, e.g. while the plugin is still being installed. The version's summary keeps
 * saying so until a check finds them.
 */
export function guardPlugins(inventory: DocumentInventory | null, accepted: boolean): void {
	if (!inventory || accepted) return;
	const { missingPlugins, unloadedComponents = [] } = summarizeInventory(inventory);
	if (!missingPlugins.length && !unloadedComponents.length) return;
	const lacks = [
		missingPlugins.length && `${missingPlugins.join(', ')} installed`,
		unloadedComponents.length &&
			`the components ${unloadedComponents.join(', ')} (its plugin release is older than the file's)`
	].filter(Boolean);
	apiError(
		422,
		ApiErrorCode.UNPROCESSABLE,
		`The Compute server does not have ${lacks.join(', nor ')}, so solves would drop those ` +
			`components and miss their outputs. Install or update the plugin first, or upload anyway ` +
			`with acceptMissingPlugins=true.`,
		undefined,
		{
			missingPlugins: missingPlugins.join(', '),
			unloadedComponents: unloadedComponents.join(', ')
		}
	);
}

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
	const acceptMissingPlugins = formText(form, 'acceptMissingPlugins') === 'true';

	const { ctx, record, project } = await requireEditableDefinition(req, guid);
	const data = new Uint8Array(await file.arrayBuffer());
	const server = await resolveServerForOrg(ctx, project?.orgId ?? null, req.deps.computeServer, {
		definitionPin: record.computeServerId ?? null
	});
	const { schema, inventory, defaultsPending, savedValues, savedValuesLater } =
		await extractSchemaForUpload(data, server);
	return {
		ctx,
		record,
		file,
		extension,
		data,
		schema,
		inventory,
		defaultsPending,
		savedValues: savedValues ?? savedValuesLater,
		changeNote,
		acceptMissingPlugins
	};
}

/**
 * What uploading this file would change, without uploading it: the same checks as an upload,
 * then a diff against the version it would follow. Writes nothing.
 */
export const checkVersion: ApiHandler = async (req) => {
	const guid = parseParam(req.params.guid, GuidSchema, 'GUID');
	const { ctx, record, schema, inventory, defaultsPending } = await readVersionUpload(req, guid);
	const base = await loadBase(req, ctx, record);
	return {
		body: {
			schema: {
				name: schema.name,
				inputs: schema.inputs?.length ?? 0,
				outputs: schema.outputs?.length ?? 0
			},
			base: refOf(base),
			changes: changesFrom(base, schema, defaultsPending),
			defaultsPending,
			inventory: inventoryReport(inventory, schema, base)
		}
	};
};

/** Upload a new version. Advances `draft`; `live` is unchanged until publish. */
export const uploadVersion: ApiHandler = async (req) => {
	const guid = parseParam(req.params.guid, GuidSchema, 'GUID');
	const upload = await readVersionUpload(req, guid);
	const { ctx, record, file, extension, data, schema, inventory, changeNote } = upload;
	guardPlugins(inventory, upload.acceptMissingPlugins);
	// Before the upload: it moves the draft pointer to the new version.
	const base = await loadBase(req, ctx, record);

	const { inventory: _stored, ...version } = await definitionService(req.deps).uploadVersion(
		ctx,
		guid,
		data,
		extension.slice(1) as 'gh' | 'ghx',
		file.name,
		schema,
		changeNote,
		inventory,
		upload.savedValues
	);
	return created({
		version,
		base: refOf(base),
		changes: changesFrom(base, schema, upload.defaultsPending),
		defaultsPending: upload.defaultsPending,
		inventory: inventoryReport(inventory, schema, base)
	});
};

// ============================================================================
// What a version changed
// ============================================================================

/**
 * What a version changed, from what was cached at upload. `?against=` names the version to
 * compare with; without it, the one numbered just before. The first version has no base.
 */
export const getVersionChanges: ApiHandler = async (req) => {
	const guid = parseParam(req.params.guid, GuidSchema, 'GUID');
	const versionId = parseParam(req.params.versionId, GuidSchema, 'version ID');
	const { ctx } = requireCaller(req);

	const version = await loadVisibleVersion(ctx, guid, versionId, req.deps);
	if (!version) apiError(404, ApiErrorCode.NOT_FOUND, 'Version not found');
	const base = await loadCompareBase(req, ctx, guid, version);

	// Components, internal values and script changes show how a definition works, which someone
	// who may only run it is not entitled to: editors only. `inventory` is absent otherwise.
	const visible = await loadVisibleDefinition(ctx, guid, req.deps);
	const editor = !!visible && mayUploadToDefinition(ctx, visible, req.deps);
	return {
		body: {
			base: refOf(base),
			changes: changesFrom(base, version.schema),
			...(editor && { inventory: inventoryReport(version.inventory, version.schema, base) })
		}
	};
};

/** `?against=` when given, else the version numbered just before. Null for the first version. */
async function loadCompareBase(
	req: ApiRequest,
	ctx: RequestContext,
	guid: string,
	version: DefinitionVersion
): Promise<DefinitionVersion | null> {
	const against = req.url.searchParams.get('against');
	if (against) {
		const againstId = parseParam(against, GuidSchema, 'against');
		const base = await loadVisibleVersion(ctx, guid, againstId, req.deps);
		if (!base) apiError(404, ApiErrorCode.NOT_FOUND, 'Version to compare against not found');
		return base;
	}
	// Newest first, so the first lower number is the one just before.
	const all = (await req.deps.definitionMeta.listVersionsFor(ctx, [guid])).get(guid) ?? [];
	const previous = all.find((v) => v.versionNumber < version.versionNumber);
	return previous ? req.deps.definitionMeta.getVersion(ctx, previous.id) : null;
}

// ============================================================================
// Reading a stored file again
// ============================================================================

/** An editable definition's version, and the Compute server it solves on. */
async function loadEditableVersion(req: ApiRequest, guid: string, versionId: string) {
	const { ctx, record, project } = await requireEditableDefinition(req, guid);
	const version = await req.deps.definitionMeta.getVersion(ctx, versionId);
	if (!version || version.definitionId !== record.guid) {
		apiError(404, ApiErrorCode.NOT_FOUND, 'Version not found');
	}
	const server = await resolveServerForOrg(ctx, project?.orgId ?? null, req.deps.computeServer, {
		definitionPin: record.computeServerId ?? null
	});
	return { ctx, version, server };
}

async function readStoredFile(req: ApiRequest, version: DefinitionVersion): Promise<Uint8Array> {
	const bytes = await req.deps.storage.get(version.fileKey);
	if (!bytes) apiError(404, ApiErrorCode.NOT_FOUND, "The version's file is missing from storage");
	return bytes;
}

/**
 * Re-reads a stored version's inventory through Compute: for a version uploaded before
 * inventories existed, and to clear "needs plugin" once the plugin is installed.
 */
export const refreshVersionInventory: ApiHandler = async (req) => {
	const guid = parseParam(req.params.guid, GuidSchema, 'GUID');
	const versionId = parseParam(req.params.versionId, GuidSchema, 'version ID');
	const { ctx, version, server } = await loadEditableVersion(req, guid, versionId);

	const { inventory } = await fetchExtraction(await readStoredFile(req, version), server);
	if (!inventory) {
		apiError(
			422,
			ApiErrorCode.UNPROCESSABLE,
			'This Compute server cannot build an inventory. Update the server and its Selva plugin.'
		);
	}
	const summary = summarizeInventory(inventory);
	await req.deps.definitionMeta.setVersionInventory(ctx, version.id, inventory, summary);
	return {
		body: {
			summary,
			warnings: inventoryWarnings(inventory),
			plugins: pluginRequirements(inventory),
			extractedWith: inventory.extractedWith
		}
	};
};

/**
 * One script's code in this version and the one it is compared with, and the line diff between
 * them. Read from the stored files through Compute on each call and never kept: the inventory
 * holds fingerprints only, so the code lives in one place, the `.gh`.
 */
export const getVersionScriptDiff: ApiHandler = async (req) => {
	const guid = parseParam(req.params.guid, GuidSchema, 'GUID');
	const versionId = parseParam(req.params.versionId, GuidSchema, 'version ID');
	const scriptId = parseParam(req.params.scriptId, GuidSchema, 'script ID');
	const { ctx, version, server } = await loadEditableVersion(req, guid, versionId);
	const base = await loadCompareBase(req, ctx, guid, version);

	const read = async (v: DefinitionVersion | null) =>
		v
			? ((await fetchScriptSources(await readStoredFile(req, v), [scriptId], server))[0] ?? null)
			: null;
	const [before, after] = await Promise.all([read(base), read(version)]);
	if (!before && !after) apiError(404, ApiErrorCode.NOT_FOUND, 'No script with that id');

	return {
		body: {
			base: refOf(base),
			before,
			after,
			lines: diffLines(before?.source ?? '', after?.source ?? '')
		}
	};
};

// ============================================================================
// Read and delete
// ============================================================================

/**
 * Version metadata. `schema` and `inventory` are excluded (`/schema` and `/changes` serve them),
 * so a version read never carries a several-hundred-KB blob.
 */
export const getVersion: ApiHandler = async (req) => {
	const guid = parseParam(req.params.guid, GuidSchema, 'GUID');
	const versionId = parseParam(req.params.versionId, GuidSchema, 'version ID');
	const { ctx } = requireCaller(req);

	const version = await loadVisibleVersion(ctx, guid, versionId, req.deps);
	if (!version) apiError(404, ApiErrorCode.NOT_FOUND, 'Version not found');
	const { schema: _schema, inventory: _inventory, ...rest } = version;
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
