/**
 * Selva's MCP tools: find a definition, read its form, solve it, read back numbers and files,
 * render it, check what it needs from Compute, upload and compare versions, edit its details and
 * cover, publish a version, and list or create projects. No deletes, share links, tokens or admin.
 */

import {
	fromOperation,
	listOutput,
	SOLVE_VIEW_KEY,
	SOLVE_VIEW_URI,
	tool,
	type BinaryData,
	type SolveViewData,
	type ToolDefinition,
	type UntypedApi
} from '@selvajs/mcp';
import { captureSolve, CaptureUnavailableError, type CaptureView } from '@selvajs/mcp/capture';
import {
	inventoryDiffToMarkdown,
	inventoryWarningText,
	schemaDiffToMarkdown,
	type InventoryDiff,
	type InventorySummary,
	type InventoryWarning,
	type SchemaDiff,
	type UISchema
} from '@selvajs/schemas';
import { z } from 'zod';
import { ProjectVisibilitySchema } from '@selvajs/platform';
import { describeInputs, formText, resolveValues, viewInputs } from './form.js';
import {
	channelText,
	definitionArg,
	getRecord,
	listedText,
	pickVersion,
	projectArg,
	resolveDefinition,
	resolveProject,
	versionArg,
	versionLabel,
	type DefinitionItem,
	type DefinitionRecord,
	type Page,
	type ProjectItem,
	type VersionSummary
} from './lookup.js';
import { isPlumbing, summarizeSolve, type SolveResponse } from './solve-output.js';
import { fromJsonBytes, jsonBytes, type Stash } from './stash.js';
import { captureHdr, captureHtml } from './views.js';

interface ProjectMemberItem {
	userId: string;
	role: string;
	joinedAt?: string;
	displayName?: string | null;
}

interface VersionItem extends VersionSummary {
	uploadedBy?: string;
	inventorySummary?: InventorySummary;
}

interface PluginRequirement {
	name: string;
	version: string;
	serverVersion: string | null;
}

/** The `inventory` of a check, upload or `/changes`, or the body of a recheck. */
interface InventoryReport {
	warnings: InventoryWarning[];
	plugins?: PluginRequirement[];
	extractedWith?: string;
	diff?: InventoryDiff | null;
}

// ============================================================================
// Solving a chosen version
// ============================================================================

const valuesArg = z
	.record(z.string(), z.unknown())
	.default({})
	.describe(
		'Input values keyed by the names selva_describe_definition lists. Dropdowns take an option name.'
	);

async function schemaFor(
	api: UntypedApi,
	guid: string,
	version: string | undefined,
	signal: AbortSignal
): Promise<{ schema: UISchema; versionId?: string; record?: DefinitionRecord }> {
	if (!version || version === 'live') {
		const schema = (await api.call('getDefinitionsByGuidSchema', {
			params: { guid },
			signal
		})) as UISchema;
		return { schema };
	}
	const record = await getRecord(api, guid, signal);
	const picked = pickVersion(record, version);
	const schema = (await api.call('getDefinitionsByGuidVersionsByVersionIdSchema', {
		params: { guid, versionId: picked.id },
		signal
	})) as UISchema;
	return { schema, versionId: picked.id, record };
}

async function runSolve(
	api: UntypedApi,
	definition: string,
	values: Record<string, unknown>,
	version: string | undefined,
	signal: AbortSignal
) {
	const guid = await resolveDefinition(api, definition, signal);
	const { schema, versionId } = await schemaFor(api, guid, version, signal);
	const res = (await api.call('postDefinitionsByGuidSolve', {
		params: { guid },
		body: {
			// `inputs` is required: without it the server ignores `values` and solves the file's own.
			inputs: schema.inputs,
			values: resolveValues(describeInputs(schema), values),
			...(versionId && { versionId })
		},
		signal
	})) as SolveResponse;
	return { guid, schema, res };
}

const SOLVE_CALLS = [
	'getDefinitions',
	'getDefinitionsByGuid',
	'getDefinitionsByGuidSchema',
	'getDefinitionsByGuidVersionsByVersionIdSchema',
	'postDefinitionsByGuidSolve'
];

// ============================================================================
// Inventory: what a definition needs from its Compute server
// ============================================================================

function inventoryText(report: InventoryReport): string[] {
	const lines: string[] = [];
	if (report.extractedWith) {
		lines.push(
			`Read on the Compute server by Selva ${report.extractedWith}, when the version was uploaded or last rechecked.`
		);
	}
	const plugins = report.plugins ?? [];
	if (plugins.length) {
		lines.push('', 'Plugins (saved with → on the server):');
		for (const p of plugins) {
			const server = p.serverVersion ?? 'not installed';
			const flag =
				p.serverVersion === null ? '  MISSING' : p.serverVersion !== p.version ? '  differs' : '';
			lines.push(`- ${p.name}: ${p.version} → ${server}${flag}`);
		}
	} else if (report.plugins) {
		lines.push('', 'Plugins: none beyond Grasshopper and Rhino.');
	}
	lines.push('');
	if (report.warnings.length) {
		lines.push('Problems:', ...report.warnings.map((w) => `- ${inventoryWarningText(w)}`));
	} else {
		lines.push('No problems: every plugin and component it uses loaded on the Compute server.');
	}
	return lines;
}

const InventoryOutput = z.object({
	versionId: z.string(),
	versionNumber: z.number(),
	plugins: z.array(
		z.object({ name: z.string(), version: z.string(), serverVersion: z.string().nullable() })
	),
	warnings: z.array(z.record(z.string(), z.unknown())),
	extractedWith: z.string().optional()
});

function inventoryStructured(version: VersionSummary, report: InventoryReport) {
	return {
		versionId: version.id,
		versionNumber: version.versionNumber,
		plugins: report.plugins ?? [],
		warnings: report.warnings as unknown as Record<string, unknown>[],
		...(report.extractedWith && { extractedWith: report.extractedWith })
	};
}

/** What a new file changes against the version it follows, form first. */
function changesText(
	changes: SchemaDiff | null | undefined,
	inventory: InventoryReport | null | undefined,
	baseLabel: string | null
): string[] {
	const lines: string[] = [];
	if (!baseLabel) {
		lines.push('Nothing to compare with: it is the first version.');
	} else if (!changes) {
		lines.push(`The form can't be compared with ${baseLabel}: it predates cached schemas.`);
	} else if (changes.identical) {
		lines.push(`The form is the same as in ${baseLabel}.`);
	} else {
		lines.push(`Against ${baseLabel}:`, schemaDiffToMarkdown(changes));
	}
	const inside = inventory?.diff ? inventoryDiffToMarkdown(inventory.diff) : '';
	if (inside) lines.push('', '### Inside the definition', inside);
	return lines;
}

// ============================================================================
// Files the model sends
// ============================================================================

const fileArgs = {
	file: z.string().describe('The .gh or .ghx file, base64, no `data:` prefix.'),
	fileName: z
		.string()
		.regex(/\.ghx?$/i, 'must end in .gh or .ghx')
		.describe('The file name, e.g. "shelf.gh".')
};

const acceptArg = z
	.boolean()
	.default(false)
	.describe(
		'Upload even though the Compute server lacks a plugin or component it needs. Solves will miss outputs until it is installed.'
	);

function ghFile(file: string, fileName: string): Blob {
	return new File([Buffer.from(file, 'base64')], fileName, { type: 'application/octet-stream' });
}

// ============================================================================
// Images
// ============================================================================

const COVER_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

async function readCover(api: UntypedApi, guid: string, signal: AbortSignal) {
	const image = (await api.call('getDefinitionsByGuidImage', {
		params: { guid },
		bytes: true,
		signal
	})) as BinaryData;
	return {
		data: Buffer.from(image.data).toString('base64'),
		mimeType: image.contentType.split(';')[0] || 'image/webp'
	};
}

const CAPTURE_VIEWS = [
	'iso',
	'top',
	'front',
	'back',
	'left',
	'right',
	'bottom'
] as const satisfies readonly CaptureView[];

// The app's own background when a definition sets none.
const DEFAULT_BACKGROUND = '#E6E6E6';

// ============================================================================
// Tools
// ============================================================================

const ListOutput = z.object({
	items: z.array(z.record(z.string(), z.unknown())),
	nextCursor: z.string().optional()
});

/** `outputs` is keyed by the definition's own output names, so it can't be closed. */
export const SolveOutput = z.object({
	outputs: z.record(z.string(), z.unknown()),
	errors: z.array(z.string()),
	warnings: z.array(z.string()),
	link: z.string(),
	response: z.unknown().optional()
});

export const PublishOutput = z.object({
	guid: z.string(),
	versionId: z.string(),
	versionNumber: z.number(),
	link: z.string()
});

export interface SelvaToolOptions {
	/** Where file links, geometry and previews are held. */
	stash: Stash;
	/** Chromium for `selva_capture_preview`; unset uses Playwright's own. */
	previewBrowser?: string;
}

// `any`: tools bind different `Args`, and a list of them has no common type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = ToolDefinition<any, any>;

export function selvaTools(origin: string, options: SelvaToolOptions): AnyTool[] {
	const { stash } = options;
	const pageOf = (guid: string) => `${origin}/library/${encodeURIComponent(guid)}`;

	// ==========================================================================
	// Projects
	// ==========================================================================

	const listProjects = fromOperation('getProjects', {
		name: 'selva_list_projects',
		title: 'List projects',
		description:
			'Projects the key can see. Use a project id to narrow selva_list_definitions, or as the ' +
			'destination of selva_update_definition or selva_create_definition. Pages with `cursor`.',
		output: ListOutput,
		shape: (body) => {
			const page = body as Page<ProjectItem>;
			return listOutput(
				page.items,
				(p) => `- ${p.name} (id ${p.id}${p.visibility ? `, ${p.visibility}` : ''})`,
				page.nextCursor
			);
		}
	});

	const listMembers = tool({
		name: 'selva_list_project_members',
		title: 'List project members',
		description:
			"A project's members: display name, user id and role. Needs the right to manage its members.",
		input: z.object({ project: projectArg }),
		calls: ['getProjects', 'getProjectsByIdMembers'],
		async run(api, { project }, { signal }) {
			const p = await resolveProject(api, project, signal);
			const members: ProjectMemberItem[] = [];
			let cursor: string | undefined;
			do {
				const page = (await api.call('getProjectsByIdMembers', {
					params: { id: p.id },
					query: { limit: 100, cursor },
					signal
				})) as Page<ProjectMemberItem>;
				members.push(...page.items);
				cursor = page.nextCursor;
			} while (cursor);
			const lines = members.map(
				(m) =>
					`- ${m.displayName ? `${m.displayName} (${m.userId})` : m.userId}: ${m.role}` +
					(m.joinedAt ? `, since ${m.joinedAt.slice(0, 10)}` : '')
			);
			return [`# ${p.name}`, ...(lines.length ? lines : ['No members.'])].join('\n');
		}
	});

	const createProject = tool({
		name: 'selva_create_project',
		title: 'Create a project',
		description:
			'Creates a project the key’s owner owns. Private unless `visibility` says otherwise. ' +
			'Move definitions into it with selva_update_definition.',
		input: z.object({
			name: z.string().min(1).max(128),
			description: z.string().max(2000).optional(),
			visibility: ProjectVisibilitySchema.default('private')
		}),
		calls: ['postProjects'],
		async run(api, body, { signal }) {
			const project = (await api.call('postProjects', { body, signal })) as ProjectItem;
			return `Created ${project.name} (id ${project.id}, ${project.visibility ?? body.visibility}).`;
		}
	});

	// ==========================================================================
	// Reading definitions
	// ==========================================================================

	const listDefinitions = fromOperation('getDefinitions', {
		name: 'selva_list_definitions',
		title: 'List definitions',
		description:
			'Grasshopper definitions the key can see, newest changes first. Filter by `projectId`. ' +
			'Each line says whether it can be solved (it has a live version) and whether the library ' +
			'lists it. Then call selva_describe_definition with a guid.',
		output: ListOutput,
		omit: ['status'],
		shape: (body) => {
			const page = body as Page<DefinitionItem>;
			// `status` reads as "can it run"; it isn't, so the model gets the two facts instead.
			const items = page.items.map(({ status, ...d }) => ({
				...d,
				solvable: !!d.liveVersionId,
				listedInLibrary: status === 'published'
			}));
			return listOutput(
				items,
				(d) =>
					`- ${d.displayName} (guid ${d.guid}, ` +
					`${d.solvable ? 'solvable' : 'no live version, cannot be solved'}` +
					`${d.listedInLibrary ? '' : ', not listed in the library'})` +
					(d.description ? `: ${d.description}` : ''),
				page.nextCursor
			);
		}
	});

	const describeDefinition = tool({
		name: 'selva_describe_definition',
		title: 'Describe a definition',
		description:
			"A definition's form as its users see it: groups with their descriptions, then each " +
			'input (name, type, range, unit, options, default, when it shows, description) and ' +
			'output. Also which version is live. Call before selva_solve; pass inputs to it by the ' +
			'quoted name. `version` reads an upload that is not live yet.',
		input: z.object({ definition: definitionArg, version: versionArg }),
		calls: [
			'getDefinitions',
			'getDefinitionsByGuid',
			'getDefinitionsByGuidSchema',
			'getDefinitionsByGuidVersionsByVersionIdSchema'
		],
		async run(api, { definition, version }, { signal }) {
			const guid = await resolveDefinition(api, definition, signal);
			const record = await getRecord(api, guid, signal);
			if (!record.liveVersion && (!version || version === 'live')) {
				return `# ${record.displayName}\n${channelText(record)}`;
			}
			const picked = pickVersion(record, version);
			const schema = (await (picked.id === record.liveVersion?.id
				? api.call('getDefinitionsByGuidSchema', { params: { guid }, signal })
				: api.call('getDefinitionsByGuidVersionsByVersionIdSchema', {
						params: { guid, versionId: picked.id },
						signal
					}))) as UISchema;
			const lines = [`# ${schema.name || record.displayName}`, channelText(record)];
			if (picked.id !== record.liveVersion?.id) {
				lines.push(`This is ${versionLabel(record, picked)}.`);
			}
			if (schema.description) lines.push('', schema.description);
			lines.push(...formText(schema));
			return lines.join('\n');
		}
	});

	const listVersions = tool({
		name: 'selva_list_versions',
		title: 'List versions',
		description:
			"A definition's versions, newest first: number, id, upload date, change note, which is " +
			'live, and whether the server lacked something it needs. Pass an id to selva_solve, ' +
			'selva_compare_versions or selva_publish_definition (to roll back).',
		input: z.object({ definition: definitionArg }),
		calls: ['getDefinitions', 'getDefinitionsByGuid', 'getDefinitionsByGuidVersions'],
		async run(api, { definition }, { signal }) {
			const guid = await resolveDefinition(api, definition, signal);
			const record = await getRecord(api, guid, signal);
			const page = (await api.call('getDefinitionsByGuidVersions', {
				params: { guid },
				query: { limit: 50 },
				signal
			})) as Page<VersionItem>;
			const lines = page.items.map((v) => {
				const marks = [
					v.id === record.liveVersion?.id && 'live',
					v.id === record.draftVersion?.id && v.id !== record.liveVersion?.id && 'newest upload'
				].filter(Boolean);
				const needs = [
					...(v.inventorySummary?.missingPlugins ?? []),
					...(v.inventorySummary?.unloadedComponents ?? [])
				];
				return (
					`- version ${v.versionNumber} (id ${v.id}` +
					(v.uploadedAt ? `, ${v.uploadedAt.slice(0, 10)}` : '') +
					(marks.length ? `, ${marks.join(', ')}` : '') +
					(needs.length ? `, server lacks ${needs.join(', ')}` : '') +
					')' +
					(v.changeNote ? `: ${v.changeNote.split('\n')[0]}` : '')
				);
			});
			if (page.nextCursor) lines.push('Older versions are not shown.');
			return [`# ${record.displayName}`, ...(lines.length ? lines : ['No versions.'])].join('\n');
		}
	});

	const compareVersions = tool({
		name: 'selva_compare_versions',
		title: 'Compare versions',
		description:
			'What a version changed in the form (inputs, outputs, settings, with which changes break ' +
			'saved values) and, for editors, inside the file (plugins, components, values, scripts). ' +
			'Against the version before it, or `against`.',
		input: z.object({
			definition: definitionArg,
			version: versionArg,
			against: z.string().optional().describe('A version id to compare with.')
		}),
		calls: [
			'getDefinitions',
			'getDefinitionsByGuid',
			'getDefinitionsByGuidVersionsByVersionIdChanges'
		],
		async run(api, { definition, version, against }, { signal }) {
			const guid = await resolveDefinition(api, definition, signal);
			const record = await getRecord(api, guid, signal);
			const picked = pickVersion(record, version ?? 'draft');
			const res = (await api.call('getDefinitionsByGuidVersionsByVersionIdChanges', {
				params: { guid, versionId: picked.id },
				query: { against },
				signal
			})) as {
				base: VersionSummary | null;
				changes: SchemaDiff | null;
				inventory?: InventoryReport | null;
			};
			return [
				`# ${record.displayName}, ${versionLabel(record, picked)}`,
				...changesText(
					res.changes,
					res.inventory,
					res.base ? `version ${res.base.versionNumber}` : null
				)
			].join('\n');
		}
	});

	const checkDefinition = tool({
		name: 'selva_check_definition',
		title: 'Check what a definition needs',
		description:
			'Lists the plugins a definition was saved with beside the versions its Compute server ' +
			'has loaded, and the problems that follow: a missing plugin, a component the installed ' +
			'release lacks, obsolete components, secrets left in the file. Call it when a solve fails ' +
			'or misses outputs. Editors only.',
		input: z.object({ definition: definitionArg, version: versionArg }),
		output: InventoryOutput,
		calls: [
			'getDefinitions',
			'getDefinitionsByGuid',
			'getDefinitionsByGuidVersionsByVersionIdChanges'
		],
		async run(api, { definition, version }, { signal }) {
			const guid = await resolveDefinition(api, definition, signal);
			const record = await getRecord(api, guid, signal);
			const picked = pickVersion(record, version ?? (record.liveVersion ? 'live' : 'draft'));
			const changes = (await api.call('getDefinitionsByGuidVersionsByVersionIdChanges', {
				params: { guid, versionId: picked.id },
				signal
			})) as { inventory?: InventoryReport | null };
			const head = `# ${record.displayName}, ${versionLabel(record, picked)}`;
			if (changes.inventory === undefined) {
				throw new Error(
					`${head}\nOnly people who can upload to this definition see what is inside it.`
				);
			}
			if (changes.inventory === null) {
				throw new Error(
					`${head}\nThis version has no inventory: it was uploaded before Selva read them, or ` +
						"by a server whose Selva plugin can't. selva_recheck_definition reads it now."
				);
			}
			const report = changes.inventory;
			return {
				text: [
					head,
					...inventoryText(report),
					'',
					'Installed or updated a plugin since? selva_recheck_definition reads it again.'
				].join('\n'),
				structured: inventoryStructured(picked, report)
			};
		}
	});

	const recheckDefinition = tool({
		name: 'selva_recheck_definition',
		title: 'Recheck a definition against Compute',
		description:
			"Reads a version's file again on its Compute server and stores what it finds, then " +
			'reports it like selva_check_definition. Use after a plugin was installed or updated.',
		input: z.object({ definition: definitionArg, version: versionArg }),
		output: InventoryOutput,
		calls: [
			'getDefinitions',
			'getDefinitionsByGuid',
			'postDefinitionsByGuidVersionsByVersionIdInventory'
		],
		async run(api, { definition, version }, { signal }) {
			const guid = await resolveDefinition(api, definition, signal);
			const record = await getRecord(api, guid, signal);
			const picked = pickVersion(record, version ?? (record.liveVersion ? 'live' : 'draft'));
			const report = (await api.call('postDefinitionsByGuidVersionsByVersionIdInventory', {
				params: { guid, versionId: picked.id },
				signal
			})) as InventoryReport;
			return {
				text: [
					`# ${record.displayName}, ${versionLabel(record, picked)}`,
					...inventoryText(report)
				].join('\n'),
				structured: inventoryStructured(picked, report)
			};
		}
	});

	// ==========================================================================
	// Solving and rendering
	// ==========================================================================

	const solve = tool({
		name: 'selva_solve',
		title: 'Solve a definition',
		description:
			'Runs a definition on Rhino Compute and returns its number and text outputs, a one-line ' +
			'summary of each geometry output, and a download link per output file. Spends compute; ' +
			'can take minutes. Inputs left out keep their defaults. Call selva_describe_definition ' +
			"first. The live version by default; `version: 'draft'` tries an upload before it is " +
			'published. When it reports errors, selva_check_definition says whether the server lacks ' +
			"a plugin or component. `detail: 'full'` adds the raw solve response with geometry; it " +
			'can be very large.',
		input: z.object({
			definition: definitionArg,
			values: valuesArg,
			version: versionArg,
			detail: z.enum(['summary', 'full']).default('summary')
		}),
		output: SolveOutput,
		calls: SOLVE_CALLS,
		ui: { resourceUri: SOLVE_VIEW_URI },
		async run(api, { definition, values, version, detail }, { signal, apps }) {
			const { guid, schema, res } = await runSolve(api, definition, values, version, signal);
			const summary = await summarizeSolve(res, schema, { origin, link: pageOf(guid), stash });
			// The stashed response carries every display mesh: only worth writing for a client
			// that will show the view.
			const meta = apps
				? {
						[SOLVE_VIEW_KEY]: {
							title: schema.name,
							load: {
								tool: 'selva_solve_geometry',
								arguments: {
									token: await stash.put({
										kind: 'solve',
										name: schema.name,
										contentType: 'application/json',
										data: jsonBytes(res)
									})
								}
							},
							form: {
								tool: 'selva_solve',
								arguments: { definition: guid, ...(version && { version }) },
								valuesKey: 'values',
								inputs: viewInputs(schema, values)
							}
						} satisfies SolveViewData
					}
				: undefined;
			if (detail !== 'full') return { ...summary, meta };
			const response = { ...res, values: res.values?.filter((t) => !isPlumbing(t)) };
			return { ...summary, structured: { ...summary.structured, response }, meta };
		}
	});

	const solveGeometry = tool({
		name: 'selva_solve_geometry',
		title: 'Solve geometry',
		description: "A solve's geometry, for its 3D view.",
		input: z.object({ token: z.string() }),
		// Reads no API: the response is in the stash. `calls` must name one, and every key holds `read`.
		calls: ['getMe'],
		ui: { resourceUri: SOLVE_VIEW_URI, visibility: ['app'] },
		async run(_api, { token }) {
			const held = await stash.get(token, 'solve');
			if (!held) throw new Error('This solve’s geometry has expired. Solve again to see it.');
			return {
				text: 'Geometry.',
				meta: { [SOLVE_VIEW_KEY]: { response: fromJsonBytes(held.data) } }
			};
		}
	});

	const capturePreview = tool({
		name: 'selva_capture_preview',
		title: 'Render a preview',
		description:
			"Solves a definition and draws the result in Selva's own 3D viewer, with the look and " +
			'background the definition opens in, then returns the picture. Spends compute like ' +
			'selva_solve. The picture is kept for an hour under a preview id: pass it to ' +
			'selva_set_cover_image to make it the cover.',
		input: z.object({
			definition: definitionArg,
			values: valuesArg,
			version: versionArg,
			view: z.enum(CAPTURE_VIEWS).default('iso').describe('Camera direction.'),
			width: z.number().int().min(256).max(2048).default(1200),
			height: z.number().int().min(256).max(2048).default(800),
			grid: z.boolean().default(false).describe("Draw the viewer's ground grid.")
		}),
		calls: SOLVE_CALLS,
		async run(api, { definition, values, version, view, width, height, grid }, { signal }) {
			const { schema, res } = await runSolve(api, definition, values, version, signal);
			let capture;
			try {
				capture = await captureSolve(res, {
					view,
					width,
					height,
					grid,
					look: schema.viewerOptions?.look,
					background: schema.viewerOptions?.backgroundColor ?? DEFAULT_BACKGROUND,
					hdr: captureHdr,
					html: captureHtml,
					executablePath: options.previewBrowser || undefined,
					signal
				});
			} catch (err) {
				if (err instanceof CaptureUnavailableError) {
					throw new Error(`${err.message} An operator sets this up; the solve itself worked.`, {
						cause: err
					});
				}
				throw err;
			}
			if (!capture.drawn) {
				return `${schema.name} solved, but drew nothing: it has no Display output with geometry for these values.`;
			}
			const previewId = await stash.put({
				kind: 'preview',
				name: `${schema.name}.png`,
				contentType: 'image/png',
				data: new Uint8Array(Buffer.from(capture.png, 'base64'))
			});
			return {
				text: `${schema.name}, ${view} view, ${width}×${height}. Preview id ${previewId}.`,
				images: [{ data: capture.png, mimeType: 'image/png' }]
			};
		}
	});

	// ==========================================================================
	// Uploading
	// ==========================================================================

	const checkUpload = tool({
		name: 'selva_check_upload',
		title: 'Check a file before uploading it',
		description:
			'Dry run of selva_upload_version: reads the file on the Compute server and reports what ' +
			'it would change in the form and inside the file, and whether the server lacks a plugin ' +
			'or component it needs. Uploads nothing.',
		input: z.object({ definition: definitionArg, ...fileArgs }),
		calls: ['getDefinitions', 'postDefinitionsByGuidVersionsCheck'],
		async run(api, { definition, file, fileName }, { signal }) {
			const guid = await resolveDefinition(api, definition, signal);
			const form = new FormData();
			form.append('file', ghFile(file, fileName));
			const res = (await api.call('postDefinitionsByGuidVersionsCheck', {
				params: { guid },
				body: form,
				signal
			})) as {
				schema: { name: string; inputs: number; outputs: number };
				base: VersionSummary | null;
				changes: SchemaDiff | null;
				inventory: InventoryReport | null;
			};
			return [
				`# ${res.schema.name}: ${res.schema.inputs} inputs, ${res.schema.outputs} outputs`,
				...changesText(
					res.changes,
					res.inventory,
					res.base ? `version ${res.base.versionNumber}` : null
				),
				...(res.inventory ? ['', ...inventoryText(res.inventory)] : [])
			].join('\n');
		}
	});

	const uploadVersion = tool({
		name: 'selva_upload_version',
		title: 'Upload a new version',
		description:
			'Uploads a .gh or .ghx as the next version of a definition. It is not live until ' +
			"selva_publish_definition; until then solve it with `version: 'draft'`. Refused when the " +
			'Compute server lacks a plugin or component it needs, unless `acceptMissingPlugins`.',
		input: z.object({
			definition: definitionArg,
			...fileArgs,
			changeNote: z.string().max(10_000).optional().describe('Markdown: what changed.'),
			acceptMissingPlugins: acceptArg
		}),
		calls: ['getDefinitions', 'postDefinitionsByGuidVersions'],
		async run(api, { definition, file, fileName, changeNote, acceptMissingPlugins }, { signal }) {
			const guid = await resolveDefinition(api, definition, signal);
			const form = new FormData();
			form.append('file', ghFile(file, fileName));
			if (changeNote) form.append('changeNote', changeNote);
			if (acceptMissingPlugins) form.append('acceptMissingPlugins', 'true');
			const res = (await api.call('postDefinitionsByGuidVersions', {
				params: { guid },
				body: form,
				signal
			})) as {
				version: VersionSummary;
				base: VersionSummary | null;
				changes: SchemaDiff | null;
				inventory: InventoryReport | null;
			};
			return [
				`Uploaded version ${res.version.versionNumber} (id ${res.version.id}). It is not live: ` +
					"solve it with `version: 'draft'`, then selva_publish_definition.",
				...changesText(
					res.changes,
					res.inventory,
					res.base ? `version ${res.base.versionNumber}` : null
				),
				...(res.inventory?.warnings.length
					? ['', 'Problems:', ...res.inventory.warnings.map((w) => `- ${inventoryWarningText(w)}`)]
					: [])
			].join('\n');
		}
	});

	const createDefinition = tool({
		name: 'selva_create_definition',
		title: 'Create a definition',
		description:
			'Uploads a .gh or .ghx as a new definition in a project. Its first version is live at ' +
			'once, but the library lists it only after selva_publish_definition. Refused when the ' +
			'Compute server lacks a plugin or component it needs, unless `acceptMissingPlugins`.',
		input: z.object({
			project: projectArg,
			...fileArgs,
			displayName: z.string().min(1).max(256),
			description: z.string().max(2000).optional(),
			category: z.string().max(128).optional(),
			tags: z
				.array(
					z
						.string()
						.max(64)
						.regex(/^[^,]*$/, 'no commas')
				)
				.max(20)
				.optional(),
			acceptMissingPlugins: acceptArg
		}),
		calls: ['getProjects', 'postDefinitions'],
		async run(api, args, { signal }) {
			const project = await resolveProject(api, args.project, signal);
			const form = new FormData();
			form.append('file', ghFile(args.file, args.fileName));
			form.append('projectId', project.id);
			form.append('displayName', args.displayName);
			if (args.description) form.append('description', args.description);
			if (args.category) form.append('category', args.category);
			if (args.tags?.length) form.append('tags', args.tags.join(','));
			if (args.acceptMissingPlugins) form.append('acceptMissingPlugins', 'true');
			const res = (await api.call('postDefinitions', { body: form, signal })) as {
				guid: string;
				version: VersionSummary;
			};
			return (
				`Created ${args.displayName} (guid ${res.guid}) in ${project.name}. Version ` +
				`${res.version.versionNumber} is live; the library lists it after selva_publish_definition. ` +
				pageOf(res.guid)
			);
		}
	});

	// ==========================================================================
	// Editing
	// ==========================================================================

	const updateDefinition = tool({
		name: 'selva_update_definition',
		title: 'Edit a definition’s details',
		description:
			'Changes the name, description, category or tags, or moves the definition to another ' +
			'project. Fields left out stay as they are; null clears one. Does not touch versions: ' +
			'selva_publish_definition makes one live.',
		input: z.object({
			definition: definitionArg,
			displayName: z.string().min(1).max(256).optional(),
			description: z.string().max(2000).nullable().optional(),
			category: z.string().max(128).nullable().optional(),
			tags: z.array(z.string().max(64)).max(20).nullable().optional(),
			project: projectArg.optional().describe('Move it into this project.')
		}),
		calls: ['getDefinitions', 'getProjects', 'patchDefinitionsByGuid', 'getDefinitionsByGuid'],
		async run(api, { definition, project, ...fields }, { signal }) {
			const guid = await resolveDefinition(api, definition, signal);
			const patch: Record<string, unknown> = Object.fromEntries(
				Object.entries(fields).filter(([, v]) => v !== undefined)
			);
			let destination: ProjectItem | undefined;
			if (project) {
				destination = await resolveProject(api, project, signal);
				patch.projectId = destination.id;
			}
			if (!Object.keys(patch).length)
				throw new Error('Nothing to change: pass at least one field.');
			await api.call('patchDefinitionsByGuid', { params: { guid }, body: patch, signal });
			const r = await getRecord(api, guid, signal);
			return [
				`Updated ${r.displayName} (guid ${guid}).`,
				r.description ? `Description: ${r.description}` : 'No description.',
				`Category: ${r.category || 'none'}. Tags: ${r.tags?.length ? r.tags.join(', ') : 'none'}.`,
				destination ? `Now in project ${destination.name}.` : `Project id ${r.projectId}.`,
				listedText(r.status),
				pageOf(guid)
			].join('\n');
		}
	});

	const getCover = tool({
		name: 'selva_get_cover_image',
		title: 'Show the cover image',
		description: "A definition's cover image, as a picture.",
		input: z.object({ definition: definitionArg }),
		calls: ['getDefinitions', 'getDefinitionsByGuidImage'],
		async run(api, { definition }, { signal }) {
			const guid = await resolveDefinition(api, definition, signal);
			return { text: 'The cover image.', images: [await readCover(api, guid, signal)] };
		}
	});

	const setCover = tool({
		name: 'selva_set_cover_image',
		title: 'Set the cover image',
		description:
			"Replaces a definition's cover image with a preview from selva_capture_preview, or with " +
			'an image given as base64. Returns the stored cover to check.',
		input: z
			.object({
				definition: definitionArg,
				previewId: z.string().optional().describe('From selva_capture_preview, within the hour.'),
				image: z.string().optional().describe('Base64 image bytes, no `data:` prefix.'),
				mimeType: z.enum(COVER_TYPES).optional().describe('The type of `image`. Default PNG.')
			})
			.refine((a) => !!a.previewId !== !!a.image, {
				message: 'Pass either previewId or image.'
			}),
		calls: ['getDefinitions', 'postDefinitionsByGuidImage', 'getDefinitionsByGuidImage'],
		async run(api, { definition, previewId, image, mimeType }, { signal }) {
			const guid = await resolveDefinition(api, definition, signal);
			let bytes: Uint8Array;
			let type: string;
			if (previewId) {
				const held = await stash.get(previewId, 'preview');
				if (!held) throw new Error('That preview has expired. Call selva_capture_preview again.');
				bytes = held.data;
				type = held.contentType;
			} else {
				bytes = new Uint8Array(Buffer.from(image!, 'base64'));
				type = mimeType ?? 'image/png';
			}
			const form = new FormData();
			form.append('image', new Blob([bytes as BlobPart], { type }), `cover.${type.split('/')[1]}`);
			await api.call('postDefinitionsByGuidImage', { params: { guid }, body: form, signal });
			return {
				text: `The cover is set. This is what the library now shows: ${pageOf(guid)}`,
				images: [await readCover(api, guid, signal)]
			};
		}
	});

	const publish = tool({
		name: 'selva_publish_definition',
		title: 'Publish a definition',
		description:
			'Makes a version live and lists the definition in the library. Without `versionId` it ' +
			'publishes the newest upload that is not live, or, when there is none, the version already ' +
			'live (which only lists it). An older version id rolls back. Changes what everyone runs: ' +
			'confirm with the user first.',
		input: z.object({
			definition: definitionArg,
			versionId: z
				.string()
				.optional()
				.describe('A version id from selva_list_versions, including an older one to roll back to.')
		}),
		output: PublishOutput,
		calls: ['getDefinitions', 'getDefinitionsByGuid', 'postDefinitionsByGuidPublish'],
		async run(api, { definition, versionId }, { signal }) {
			const guid = await resolveDefinition(api, definition, signal);
			const record = await getRecord(api, guid, signal);
			// The endpoint defaults to the draft alone; a definition whose only
			// version is already live would get "No version to publish".
			const target = versionId ?? record.draftVersion?.id ?? record.liveVersion?.id;
			if (!target) throw new Error(`${record.displayName} has no uploaded version to publish.`);
			const { version } = (await api.call('postDefinitionsByGuidPublish', {
				params: { guid },
				body: { versionId: target },
				signal
			})) as { version: { id: string; versionNumber: number } };
			const link = pageOf(guid);
			return {
				text: `${record.displayName}: version ${version.versionNumber} is live and the library lists it. ${link}`,
				structured: { guid, versionId: version.id, versionNumber: version.versionNumber, link }
			};
		}
	});

	return [
		listProjects,
		listMembers,
		createProject,
		listDefinitions,
		describeDefinition,
		listVersions,
		compareVersions,
		checkDefinition,
		recheckDefinition,
		solve,
		solveGeometry,
		capturePreview,
		checkUpload,
		uploadVersion,
		createDefinition,
		updateDefinition,
		getCover,
		setCover,
		publish
	];
}

export const INSTRUCTIONS =
	'Selva runs Grasshopper definitions on Rhino Compute. To answer a design question: find a ' +
	'definition (selva_list_definitions), read its form (selva_describe_definition), then solve it ' +
	'(selva_solve) and read the numbers back. A definition can be solved when it has a live ' +
	'version; whether the library lists it is separate. To change one: check the file ' +
	"(selva_check_upload), upload it (selva_upload_version), try it with `version: 'draft'`, then " +
	'publish. When a solve fails or misses outputs, selva_check_definition compares what the file ' +
	'needs with what the Compute server has loaded. Solving and rendering (selva_capture_preview) ' +
	'spend the owner’s compute budget: confirm with the user before a series of them. Publishing ' +
	'changes what everyone runs: confirm before calling selva_publish_definition.';
