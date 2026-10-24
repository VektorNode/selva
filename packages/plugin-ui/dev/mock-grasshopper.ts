// Stand-in for Selva.gha's WebSocket so /builder and /preview can be worked on without Rhino.
// Serves a tower-massing definition: a placed layout across several tabs plus unplaced
// parameters for the sidebar. Saves are kept in memory until the process exits. Also fakes the
// plugin's Selva client, so "Upload to Selva" can be walked through without an instance.
//
// Separate from e2e/ws-stub.ts on purpose: the E2E stub stays minimal so its assertions
// don't shift whenever this demo data grows.
//
//   pnpm dev:plugin:mock                               mock + Vite dev server
//   node dev/mock-grasshopper.ts [--port 8765] [--latency 250] [--player]   mock only

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { UI_SCHEMA_VERSION } from '@selvajs/schemas';
import type {
	DiscoveredInput,
	DiscoveredOutput,
	GroupConfig,
	GroupVisibilityCondition,
	LayoutItem,
	SelvaAccount,
	SelvaProject,
	SelvaTargets,
	SelvaUploadProgress,
	SelvaUploadRequest,
	SelvaUploadResult,
	SelvaVersionTarget,
	TabConfig,
	UISchema,
	VisibilityRule
} from '@selvajs/schemas';

function readFlag(name: string, fallback: number): number {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? Number(process.argv[i + 1]) : fallback;
}

const PORT = readFlag('port', 8765);
const SOLVE_LATENCY_MS = readFlag('latency', 250);
// --player acknowledges sockets as a player session, the way a definition opened from the panel is.
const PLAYER = process.argv.includes('--player');

// ============================================================================
// Discovered parameters (what Grasshopper would report)
// ============================================================================

type InputSpec = Partial<DiscoveredInput> & Pick<DiscoveredInput, 'id' | 'nickname' | 'type'>;

function input(spec: InputSpec): DiscoveredInput {
	return { ...spec, name: spec.name ?? spec.nickname, description: spec.description ?? '' };
}

const INPUTS: DiscoveredInput[] = [
	// Massing
	input({
		id: 'floors',
		nickname: 'Floors',
		type: 'integer',
		default: 12,
		minimum: 1,
		maximum: 60,
		stepSize: 1,
		groupName: 'Massing',
		description: 'Number of storeys above ground'
	}),
	input({
		id: 'floor-height',
		nickname: 'Floor Height',
		type: 'number',
		default: 3.4,
		minimum: 2.8,
		maximum: 5,
		stepSize: 0.1,
		groupName: 'Massing'
	}),
	input({
		id: 'width',
		nickname: 'Footprint Width',
		type: 'number',
		default: 24,
		minimum: 10,
		maximum: 60,
		stepSize: 0.5,
		groupName: 'Massing'
	}),
	input({
		id: 'depth',
		nickname: 'Footprint Depth',
		type: 'number',
		default: 18,
		minimum: 10,
		maximum: 60,
		stepSize: 0.5,
		groupName: 'Massing'
	}),
	input({
		id: 'twist',
		nickname: 'Twist',
		type: 'number',
		default: 0,
		minimum: 0,
		maximum: 90,
		stepSize: 1,
		groupName: 'Massing',
		description: 'Total rotation from base to crown, in degrees'
	}),
	input({
		id: 'taper',
		nickname: 'Taper',
		type: 'number',
		default: 0.15,
		minimum: 0,
		maximum: 0.6,
		stepSize: 0.01,
		groupName: 'Massing'
	}),
	input({
		id: 'core',
		nickname: 'Core Type',
		type: 'valueList',
		default: 'central',
		options: { central: 'Central', offset: 'Offset', split: 'Split' },
		groupName: 'Massing'
	}),
	input({
		id: 'rounded',
		nickname: 'Rounded Corners',
		type: 'boolean',
		default: false,
		groupName: 'Massing'
	}),
	input({
		id: 'corner-radius',
		nickname: 'Corner Radius',
		type: 'number',
		default: 2,
		minimum: 0.5,
		maximum: 8,
		stepSize: 0.25,
		groupName: 'Massing'
	}),

	// Facade
	input({
		id: 'panel-width',
		nickname: 'Panel Width',
		type: 'number',
		default: 1.5,
		minimum: 0.6,
		maximum: 3,
		stepSize: 0.05,
		groupName: 'Facade'
	}),
	input({
		id: 'panel-type',
		nickname: 'Panel Type',
		type: 'valueList',
		default: 'unitized',
		options: { unitized: 'Unitized', stick: 'Stick', precast: 'Precast' },
		groupName: 'Facade'
	}),
	input({
		id: 'glazing',
		nickname: 'Glazing Ratio',
		type: 'number',
		default: 0.55,
		minimum: 0,
		maximum: 1,
		stepSize: 0.01,
		groupName: 'Facade'
	}),
	input({
		id: 'mullion-depth',
		nickname: 'Mullion Depth',
		type: 'number',
		default: 0.15,
		minimum: 0.05,
		maximum: 0.6,
		stepSize: 0.01,
		groupName: 'Facade'
	}),
	input({
		id: 'panel-color',
		nickname: 'Panel Color',
		type: 'color',
		default: '#c8ccd2',
		groupName: 'Facade'
	}),
	input({
		id: 'accent-color',
		nickname: 'Accent Color',
		type: 'color',
		default: '#2f6fd6',
		groupName: 'Facade'
	}),
	input({
		id: 'shading',
		nickname: 'Shading Fins',
		type: 'boolean',
		default: true,
		groupName: 'Facade'
	}),
	input({
		id: 'fin-spacing',
		nickname: 'Fin Spacing',
		type: 'number',
		default: 0.9,
		minimum: 0.3,
		maximum: 3,
		stepSize: 0.05,
		groupName: 'Facade'
	}),
	input({
		id: 'fin-depth',
		nickname: 'Fin Depth',
		type: 'number',
		default: 0.4,
		minimum: 0.1,
		maximum: 1.2,
		stepSize: 0.05,
		groupName: 'Facade'
	}),

	// Site
	input({
		id: 'site-boundary',
		nickname: 'Site Boundary',
		type: 'geometry',
		geometryTypes: ['curve'],
		atMost: 1,
		groupName: 'Site',
		description: 'The plot outline: pick a closed curve in Rhino'
	}),
	input({
		id: 'site-file',
		nickname: 'Site Model',
		type: 'file',
		acceptedFormats: ['.3dm', '.dxf'],
		groupName: 'Site'
	}),
	input({
		id: 'project-name',
		nickname: 'Project Name',
		type: 'text',
		default: 'Riverside Tower',
		groupName: 'Site'
	}),
	input({ id: 'address', nickname: 'Address', type: 'text', default: '', groupName: 'Site' }),
	input({
		id: 'north',
		nickname: 'North Angle',
		type: 'number',
		default: 0,
		minimum: -180,
		maximum: 180,
		stepSize: 1,
		groupName: 'Site'
	}),
	input({
		id: 'setback',
		nickname: 'Setback',
		type: 'number',
		default: 4,
		minimum: 0,
		maximum: 15,
		stepSize: 0.5,
		groupName: 'Site'
	}),

	// Analysis
	input({
		id: 'analysis',
		nickname: 'Analysis Type',
		type: 'dynamicValueList',
		groupName: 'Analysis'
	}),
	input({
		id: 'grid-size',
		nickname: 'Grid Size',
		type: 'number',
		default: 2,
		minimum: 0.5,
		maximum: 10,
		stepSize: 0.5,
		groupName: 'Analysis'
	}),
	input({
		id: 'sun-threshold',
		nickname: 'Sun Hours Threshold',
		type: 'integer',
		default: 4,
		minimum: 0,
		maximum: 12,
		stepSize: 1,
		groupName: 'Analysis'
	}),
	input({
		id: 'bake-massing',
		nickname: 'Bake Massing',
		type: 'boolean',
		default: false,
		groupName: 'Analysis'
	}),
	input({
		id: 'run-analysis',
		nickname: 'Run Analysis',
		type: 'boolean',
		default: false,
		groupName: 'Analysis'
	}),

	// Left unplaced so the sidebar has something to drag. No groupName on two of them so
	// "Group by GH group" also shows an ungrouped bucket.
	input({
		id: 'seed',
		nickname: 'Seed',
		type: 'integer',
		default: 7,
		minimum: 0,
		maximum: 999,
		stepSize: 1,
		groupName: 'Debug'
	}),
	input({
		id: 'debug',
		nickname: 'Debug Mode',
		type: 'boolean',
		default: false,
		groupName: 'Debug'
	}),
	input({
		id: 'fine-slider',
		nickname: 'Fine Offset',
		type: 'number',
		default: 0,
		minimum: 0,
		maximum: 1000,
		stepSize: 0.01,
		description: 'Trips the slider-step warning'
	}),
	input({ id: 'notes', nickname: 'Notes', type: 'text', default: '' }),
	input({
		id: 'material-lib',
		nickname: 'Material Library',
		type: 'file',
		acceptedFormats: ['.3dm'],
		groupName: 'Facade'
	}),
	input({
		id: 'balconies',
		nickname: 'Balconies',
		type: 'boolean',
		default: false,
		groupName: 'Facade'
	}),
	input({
		id: 'balcony-depth',
		nickname: 'Balcony Depth',
		type: 'number',
		default: 1.8,
		minimum: 1,
		maximum: 3,
		stepSize: 0.1,
		groupName: 'Facade'
	}),
	input({
		id: 'podium-floors',
		nickname: 'Podium Floors',
		type: 'integer',
		default: 2,
		minimum: 0,
		maximum: 6,
		stepSize: 1,
		groupName: 'Massing'
	})
];

const OUTPUTS: DiscoveredOutput[] = [
	{ id: 'gfa', nickname: 'Gross Floor Area', type: 'number', groupName: 'Results' },
	{ id: 'facade-area', nickname: 'Facade Area', type: 'number', groupName: 'Results' },
	{ id: 'panel-count', nickname: 'Panel Count', type: 'number', groupName: 'Results' },
	{ id: 'height', nickname: 'Building Height', type: 'number', groupName: 'Results' },
	{ id: 'summary', nickname: 'Summary', type: 'text', groupName: 'Results' },
	{ id: 'cost-chart', nickname: 'Cost Breakdown', type: 'chart', groupName: 'Results' },
	{
		id: 'analysis-options',
		nickname: 'Analysis Options',
		type: 'dynamicValueList',
		targetInputId: 'analysis',
		groupName: 'Analysis'
	},
	{ id: 'export', nickname: 'Export Model', type: 'file', groupName: 'Results' },
	{ id: 'warnings', nickname: 'Warnings', type: 'text' }
];

// ============================================================================
// Initial layout
// ============================================================================

const inputById = new Map(INPUTS.map((p) => [p.id, p]));
const outputById = new Map(OUTPUTS.map((p) => [p.id, p]));

function placeInput(paramId: string, extra: Record<string, unknown> = {}): LayoutItem {
	const p = inputById.get(paramId)!;
	const base = { id: `item-${paramId}`, paramId, displayName: p.nickname, ...extra };
	switch (p.type) {
		case 'number':
		case 'integer':
			return {
				...base,
				type: 'input',
				widgetType: 'number',
				config: {
					minimum: p.minimum,
					maximum: p.maximum,
					stepSize: p.stepSize,
					renderAsSlider: true
				}
			};
		case 'boolean':
			return { ...base, type: 'input', widgetType: 'checkbox' };
		case 'valueList':
			return {
				...base,
				type: 'input',
				widgetType: 'dropdown',
				config: { options: p.options ?? {} }
			};
		case 'dynamicValueList':
			return {
				...base,
				type: 'input',
				widgetType: 'dynamicValueList',
				config: { emptyBehavior: 'show-empty' }
			};
		case 'file':
			return {
				...base,
				type: 'input',
				widgetType: 'file',
				config: { acceptedFormats: p.acceptedFormats }
			};
		case 'color':
			return { ...base, type: 'input', widgetType: 'color' };
		// Same placeholder the builder uses: the page picks the control from paramType.
		case 'geometry':
		case 'point':
		case 'line':
		case 'plane':
			return { ...base, type: 'input', widgetType: 'text' };
		default:
			return { ...base, type: 'input', widgetType: 'text' };
	}
}

function placeOutput(paramId: string, extra: Record<string, unknown> = {}): LayoutItem {
	const p = outputById.get(paramId)!;
	const base = { id: `item-${paramId}`, paramId, displayName: p.nickname, ...extra };
	if (p.type === 'dynamicValueList') {
		return {
			...base,
			type: 'output',
			widgetType: 'dynamicValueList',
			config: { targetInputId: p.targetInputId! }
		};
	}
	return { ...base, type: 'output', widgetType: p.type } as LayoutItem;
}

let breakCount = 0;
function lineBreak(): LayoutItem {
	return { id: `linebreak-${++breakCount}`, type: 'linebreak' };
}

function group(
	id: string,
	label: string,
	columns: number,
	items: LayoutItem[],
	extra: Partial<GroupConfig> = {}
): GroupConfig {
	return { id, label, columns, items, ...extra };
}

// The generated VisibilityRule types `value` as an object; the evaluator compares primitives.
function showWhenTrue(paramId: string): GroupVisibilityCondition {
	const value = true as unknown as VisibilityRule['value'];
	return { mode: 'all', action: 'show', rules: [{ paramId, operator: 'equals', value }] };
}

const TABS: TabConfig[] = [
	{
		id: 'tab-massing',
		label: 'Massing',
		icon: 'mdi:office-building',
		groups: [
			group(
				'g-volume',
				'Volume',
				2,
				[
					placeInput('floors', { description: 'Storeys above ground, podium included.' }),
					placeInput('floor-height'),
					placeInput('width'),
					placeInput('depth'),
					lineBreak(),
					placeInput('twist', { span: 2, description: 'Rotation from base to crown, in degrees.' })
				],
				{ description: 'Overall envelope of the tower' }
			),
			group('g-form', 'Form', 1, [
				placeInput('taper'),
				placeInput('core'),
				placeInput('rounded'),
				placeInput('corner-radius', { visibilityCondition: showWhenTrue('rounded') })
			])
		]
	},
	{
		id: 'tab-facade',
		label: 'Facade',
		icon: 'mdi:view-grid-outline',
		groups: [
			group('g-panels', 'Panels', 3, [
				placeInput('panel-width'),
				placeInput('panel-type'),
				placeInput('glazing'),
				placeInput('mullion-depth', { span: 3 })
			]),
			group('g-colors', 'Colors', 2, [placeInput('panel-color'), placeInput('accent-color')]),
			group(
				'g-shading',
				'Shading',
				2,
				[placeInput('shading', { span: 2 }), placeInput('fin-spacing'), placeInput('fin-depth')],
				{ collapsed: true }
			)
		]
	},
	{
		id: 'tab-site',
		label: 'Site',
		icon: 'mdi:map-marker-outline',
		groups: [
			group('g-project', 'Project', 1, [placeInput('project-name'), placeInput('address')]),
			group('g-context', 'Context', 2, [
				placeInput('site-boundary', { span: 2 }),
				placeInput('site-file', { span: 2 }),
				placeInput('north'),
				placeInput('setback')
			])
		]
	},
	{
		id: 'tab-analysis',
		label: 'Analysis',
		icon: 'mdi:white-balance-sunny',
		groups: [
			group(
				'g-analysis',
				'Sun Study',
				2,
				[
					placeInput('bake-massing', { span: 2, config: { displayAs: 'button' } }),
					placeInput('run-analysis', { span: 2 }),
					placeInput('analysis'),
					placeInput('grid-size'),
					placeInput('sun-threshold'),
					placeOutput('analysis-options')
				],
				{ visibilityCondition: showWhenTrue('run-analysis') }
			)
		]
	},
	{
		id: 'tab-results',
		label: 'Results',
		icon: 'mdi:chart-box-outline',
		position: 'right',
		groups: [
			group('g-metrics', 'Key Metrics', 2, [
				placeOutput('gfa', { description: 'Sum of all floor plates, in m².' }),
				placeOutput('facade-area'),
				placeOutput('panel-count'),
				placeOutput('height')
			]),
			group('g-report', 'Report', 1, [
				placeOutput('summary'),
				placeOutput('cost-chart'),
				placeOutput('export')
			]),
			group('g-empty', 'Drop Zone', 2, [], {
				description: 'Empty on purpose: drag sidebar items here'
			})
		]
	}
];

let schema: UISchema = {
	id: 'mock-tower',
	name: 'Riverside Tower (mock)',
	description: 'Mock Grasshopper definition served by dev/mock-grasshopper.ts',
	documentId: 'mock-doc',
	projectFileName: 'riverside-tower.gh',
	category: 'Massing',
	tags: ['tower', 'residential'],
	schemaVersion: UI_SCHEMA_VERSION,
	instanceSolve: true,
	inputs: INPUTS.map((p) => ({
		id: p.id,
		nickname: p.nickname,
		paramType: p.type,
		description: p.description,
		default: p.default
	})),
	outputs: OUTPUTS.map((p) => ({
		id: p.id,
		nickname: p.nickname,
		type: p.type,
		targetInputId: p.targetInputId
	})),
	layout: { type: 'tabbed', gap: 16, tabs: TABS }
};
let schemaRevision = 1;

const values: Record<string, unknown> = Object.fromEntries(
	INPUTS.filter((p) => p.default !== undefined).map((p) => [p.id, p.default])
);

// ============================================================================
// Fake solve
// ============================================================================

function solve(): Record<string, unknown> {
	const num = (id: string) => Number(values[id] ?? 0);
	const floors = num('floors');
	const footprint = num('width') * num('depth') * (1 - num('taper') / 2);
	const height = floors * num('floor-height');
	const perimeter = 2 * (num('width') + num('depth'));
	const facadeArea = perimeter * height;
	const panels = Math.ceil(perimeter / Math.max(num('panel-width'), 0.1)) * floors;
	const round = (n: number) => Math.round(n * 10) / 10;

	const warnings: string[] = [];
	if (num('twist') > 45) warnings.push('Twist above 45° makes the facade panels non-planar.');
	if (num('glazing') > 0.8) warnings.push('Glazing ratio exceeds the energy-code limit.');

	return {
		gfa: round(footprint * floors),
		'facade-area': round(facadeArea),
		'panel-count': panels,
		height: round(height),
		summary: `${values['project-name'] || 'Untitled'}: ${floors} floors, ${round(height)} m, ${values['panel-type']} facade`,
		warnings: warnings.join('\n') || 'None',
		'cost-chart': JSON.stringify({
			data: [
				{
					type: 'bar',
					x: ['Structure', 'Facade', 'MEP', 'Fit-out'],
					y: [
						footprint * floors * 0.9,
						facadeArea * 1.4,
						footprint * floors * 0.5,
						footprint * floors * 0.7
					].map(Math.round)
				}
			],
			layout: { title: { text: 'Cost breakdown (k€)' } }
		}),
		'analysis-options': {
			targetInputId: 'analysis',
			options: values['run-analysis']
				? { 'sun-hours': 'Sun hours', radiation: 'Solar radiation', 'sky-view': 'Sky view factor' }
				: { 'sun-hours': 'Sun hours' }
		}
	};
}

// ============================================================================
// Selva account and upload
// ============================================================================

// Newtonsoft writes every unset optional as an explicit null, so the mock does too.
type WireNulls<T> = T extends readonly (infer U)[]
	? WireNulls<U>[]
	: T extends object
		? {
				[K in keyof T]-?: undefined extends T[K]
					? WireNulls<Exclude<T[K], undefined>> | null
					: WireNulls<T[K]>;
			}
		: T;

const SIGN_IN_DELAY_MS = 1500;
const KEY_DIALOG_DELAY_MS = 800;
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const FAILING_PROJECT_ID = 'p-fails';
// Uploading a new version here works, but making it live fails, as when another version went live first.
const LIVE_FAILS_GUID = '2b9e6f10-8c4d-4a7b-b1e2-3f4a5b6c7d8e';

const PROJECTS: SelvaProject[] = [
	{ id: 'p-riverside', name: 'Riverside Tower' },
	{ id: FAILING_PROJECT_ID, name: 'Archive (uploads here fail)' }
];

let account: WireNulls<SelvaAccount> = signedOut('https://selva.studio.example');

let suggestion: WireNulls<SelvaVersionTarget> | null = {
	definitionGuid: '7d1c2a4e-5b6f-4c3d-9e8f-0a1b2c3d4e5f',
	displayName: 'Riverside Tower massing',
	projectName: 'Riverside Tower',
	latestVersionNumber: 7,
	liveVersionNumber: 6,
	linkedVersionNumber: 6,
	newerVersions: [
		{
			versionNumber: 7,
			uploadedAt: '2026-10-19T15:42:00Z',
			byYou: false,
			changeNote: 'Podium setback per planning feedback'
		}
	]
};

let matches: WireNulls<SelvaVersionTarget>[] = [
	{
		definitionGuid: LIVE_FAILS_GUID,
		displayName: 'Riverside Tower (competition)',
		projectName: 'Competition 2026',
		latestVersionNumber: 2,
		liveVersionNumber: 2,
		linkedVersionNumber: null,
		newerVersions: []
	}
];

let signInTimer: ReturnType<typeof setTimeout> | undefined;
let uploadTimers: ReturnType<typeof setTimeout>[] = [];

function signedOut(origin: string | null, message: string | null = null): WireNulls<SelvaAccount> {
	return {
		status: 'signedOut',
		origin,
		host: origin ? new URL(origin).host : null,
		knownOrigins: ['https://selva.studio.example'],
		user: null,
		org: null,
		expiresAt: null,
		extraScopes: [],
		storage: 'keychain',
		message
	};
}

function signedIn(extraScopes: string[]): WireNulls<SelvaAccount> {
	const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
	return {
		...account,
		status: 'signedIn',
		user: { email: 'ada@studio.example', displayName: 'Ada Lovelace' },
		org: { id: 'org-studio', name: 'Studio Lovelace' },
		expiresAt: expires.toISOString(),
		extraScopes,
		message: null
	};
}

/** The plugin's origin rules, roughly: https anywhere, http only on this machine. */
function checkOrigin(typed: string): { origin: string } | { error: string } {
	const value = typed.trim();
	let url: URL;
	try {
		url = new URL(value.includes('://') ? value : `https://${value}`);
	} catch {
		return { error: `"${value}" isn't a web address.` };
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		return { error: 'Use an https:// address.' };
	}
	if (url.protocol === 'http:' && !LOOPBACK_HOSTS.includes(url.hostname)) {
		return {
			error:
				'Selva needs https:// unless it runs on this computer: plain http would send your sign-in across the network unencrypted.'
		};
	}
	return { origin: url.origin };
}

function sendAccount(ws: WebSocket, sessionId: string) {
	if (ws.readyState === ws.OPEN) send(ws, { type: 'selvaAccount', sessionId, account });
}

function targets(): WireNulls<SelvaTargets> {
	return {
		origin: account.origin!,
		projects: PROJECTS,
		suggestion,
		matches,
		defaults: {
			displayName: schema.name ?? 'Untitled',
			description: schema.description ?? null,
			category: schema.category ?? null,
			tags: schema.tags ?? []
		},
		file: { name: schema.projectFileName ?? 'definition.gh', sizeBytes: 1_284_096 },
		blockedReason: null
	};
}

function cancelUpload(): boolean {
	if (uploadTimers.length === 0) return false;
	uploadTimers.forEach(clearTimeout);
	uploadTimers = [];
	return true;
}

/** Re-points this file's link at what it just uploaded, as the plugin's archive chunk would. */
function linkTo(target: WireNulls<SelvaVersionTarget>) {
	const others = [suggestion, ...matches].filter(
		(t): t is WireNulls<SelvaVersionTarget> => !!t && t.definitionGuid !== target.definitionGuid
	);
	suggestion = target;
	// What the file no longer links to, Selva still finds by its document id.
	matches = others.map((t) => ({ ...t, linkedVersionNumber: null, newerVersions: [] }));
}

function failed(
	error: string | null,
	cancelled: boolean | null = null
): WireNulls<SelvaUploadResult> {
	return {
		ok: false,
		definitionGuid: null,
		displayName: null,
		versionNumber: null,
		live: false,
		url: null,
		error,
		cancelled
	};
}

function finishUpload(request: SelvaUploadRequest): WireNulls<SelvaUploadResult> {
	if (request.kind === 'newDefinition' && request.projectId === FAILING_PROJECT_ID) {
		return failed(
			"Selva couldn't open the file on Rhino.Compute: the Pufferfish plugin isn't installed there."
		);
	}

	let target: WireNulls<SelvaVersionTarget>;
	let live = request.makeLive;
	let error: string | null = null;
	if (request.kind === 'newVersion') {
		const existing = [suggestion, ...matches].find(
			(t) => t?.definitionGuid === request.definitionGuid
		);
		if (!existing) {
			return failed('That definition is gone, or you can no longer edit it.');
		}
		const version = existing.latestVersionNumber + 1;
		if (live && existing.definitionGuid === LIVE_FAILS_GUID) {
			live = false;
			error = `Uploaded as version ${version}, but making it live failed: another version went live while you were uploading.`;
		}
		target = {
			...existing,
			latestVersionNumber: version,
			liveVersionNumber: live ? version : existing.liveVersionNumber,
			linkedVersionNumber: version,
			newerVersions: []
		};
	} else {
		target = {
			definitionGuid: randomUUID(),
			displayName: request.displayName ?? 'Untitled',
			projectName: PROJECTS.find((p) => p.id === request.projectId)?.name ?? null,
			latestVersionNumber: 1,
			liveVersionNumber: request.makeLive ? 1 : null,
			linkedVersionNumber: 1,
			newerVersions: []
		};
	}
	linkTo(target);

	return {
		ok: true,
		definitionGuid: target.definitionGuid,
		displayName: target.displayName,
		versionNumber: target.latestVersionNumber,
		live,
		url: `${account.origin}/library/${target.definitionGuid}`,
		error,
		cancelled: null
	};
}

function handleSelva(ws: WebSocket, msg: Record<string, unknown>, sessionId: string) {
	switch (msg.type) {
		case 'selvaGetAccount':
			sendAccount(ws, sessionId);
			break;

		case 'selvaConnect': {
			const checked = checkOrigin(String(msg.origin ?? ''));
			account =
				'error' in checked
					? { ...account, message: checked.error }
					: signedOut(checked.origin, null);
			sendAccount(ws, sessionId);
			break;
		}

		case 'selvaSignIn':
			if (!account.origin) {
				account = { ...account, message: 'Enter your Selva instance first.' };
				sendAccount(ws, sessionId);
				break;
			}
			account = { ...account, status: 'signingIn', message: null };
			sendAccount(ws, sessionId);
			signInTimer = setTimeout(() => {
				signInTimer = undefined;
				account = signedIn([]);
				sendAccount(ws, sessionId);
			}, SIGN_IN_DELAY_MS);
			break;

		case 'selvaUseApiKey':
			// Stands in for the key dialog Rhino opens; the pasted key can do more than upload.
			setTimeout(() => {
				account = signedIn(['write:all']);
				sendAccount(ws, sessionId);
			}, KEY_DIALOG_DELAY_MS);
			break;

		case 'selvaSignOut':
			account = signedOut(account.origin);
			sendAccount(ws, sessionId);
			break;

		case 'selvaListTargets':
			if (account.status !== 'signedIn') break;
			setTimeout(() => send(ws, { type: 'selvaTargets', sessionId, targets: targets() }), 300);
			break;

		case 'selvaUpload': {
			const request = msg.request as SelvaUploadRequest;
			const progress = (stage: SelvaUploadProgress['stage']) =>
				send(ws, { type: 'selvaUploadProgress', sessionId, progress: { stage } });
			const at = (ms: number, fn: () => void) => uploadTimers.push(setTimeout(fn, ms));

			cancelUpload();
			progress('preparing');
			at(600, () => progress('uploading'));
			const failing = request.kind === 'newDefinition' && request.projectId === FAILING_PROJECT_ID;
			const publishing = request.makeLive && !failing;
			if (publishing) at(2000, () => progress('publishing'));
			at(publishing ? 2600 : 2000, () => {
				uploadTimers = [];
				send(ws, { type: 'selvaUploadResult', sessionId, result: finishUpload(request) });
			});
			break;
		}

		case 'selvaCancel':
			if (signInTimer) {
				clearTimeout(signInTimer);
				signInTimer = undefined;
				account = signedOut(account.origin, 'Sign-in cancelled.');
				sendAccount(ws, sessionId);
			} else if (cancelUpload()) {
				send(ws, { type: 'selvaUploadResult', sessionId, result: failed(null, true) });
			}
			break;
	}
}

// ============================================================================
// Socket
// ============================================================================

function send(ws: WebSocket, message: Record<string, unknown>) {
	ws.send(JSON.stringify(message));
}

// The plugin hands the page a fresh secret per session; the mock's is fixed.
const SECRET = 'mock';
const authenticated = new WeakSet<WebSocket>();

function broadcast(wss: WebSocketServer, message: Record<string, unknown>) {
	for (const client of wss.clients) if (authenticated.has(client)) send(client, message);
}

const wss = new WebSocketServer({ port: PORT });

wss.on('error', (err: NodeJS.ErrnoException) => {
	const reason =
		err.code === 'EADDRINUSE'
			? `port ${PORT} is already in use, most likely by Rhino with Selva loaded. Stop it or pass --port.`
			: err.message;
	console.error(`[mock-grasshopper] ${reason}`);
	process.exit(1);
});

wss.on('connection', (ws) => {
	let pendingSolve: ReturnType<typeof setTimeout> | undefined;

	ws.on('message', (raw) => {
		let msg: Record<string, unknown> & { type?: string; sessionId?: string };
		try {
			msg = JSON.parse(raw.toString());
		} catch {
			return;
		}

		if (!authenticated.has(ws)) {
			if (msg.type !== 'authenticate' || msg.secret !== SECRET) {
				ws.close(4401, 'Unauthorized');
				return;
			}
			authenticated.add(ws);
			// `?mode=player` on the page URL only picks the first paint; this is the role that counts.
			send(ws, { type: 'authenticated', role: PLAYER ? 'player' : 'author' });
			return;
		}

		const sessionId = msg.sessionId ?? '';

		switch (msg.type) {
			case 'requestInitialData':
				send(ws, {
					type: 'initialData',
					sessionId,
					schema,
					schemaHash: `rev-${schemaRevision}`,
					availableParams: {
						sessionId,
						timestamp: new Date().toISOString(),
						inputs: INPUTS,
						outputs: OUTPUTS
					},
					currentValues: values,
					outputs: solve(),
					isSolving: false
				});
				break;

			case 'requestCurrentValues':
				send(ws, { type: 'currentValues', sessionId, values });
				break;

			case 'saveSchema':
				schema = msg.schema as UISchema;
				schemaRevision++;
				broadcast(wss, {
					type: 'schemaUpdated',
					sessionId,
					schema,
					schemaHash: `rev-${schemaRevision}`
				});
				send(ws, { type: 'schemaSaved', sessionId, success: true });
				break;

			case 'valueUpdate':
				Object.assign(values, msg.values as Record<string, unknown>);
				clearTimeout(pendingSolve);
				pendingSolve = setTimeout(() => {
					send(ws, { type: 'outputs', sessionId, outputs: solve(), modelUnits: 'Meters' });
				}, SOLVE_LATENCY_MS);
				break;

			case 'cancelSolve':
				clearTimeout(pendingSolve);
				break;

			case 'requestSyncPreview':
				send(ws, { type: 'syncPreview', sessionId, fromGH: [], toGH: [] });
				break;

			// A pick takes a moment in Rhino; the mock always "picks" two curves.
			case 'pickGeometry':
				setTimeout(() => {
					values[msg.paramId as string] = '2 curves';
					send(ws, {
						type: 'pickGeometryResult',
						sessionId,
						requestId: msg.requestId,
						paramId: msg.paramId,
						outcome: 'picked',
						summary: '2 curves',
						error: null
					});
					send(ws, { type: 'outputs', sessionId, outputs: solve(), modelUnits: 'Meters' });
				}, 600);
				break;

			case 'clearGeometry':
				delete values[msg.paramId as string];
				break;

			case 'trigger':
				send(ws, {
					type: 'runtimeMessage',
					sessionId,
					level: 'info',
					message: `Pressed ${String(msg.paramId)}`,
					timestamp: new Date().toISOString()
				});
				break;

			case 'closeDefinition':
			case 'editInGrasshopper':
				console.info(`[mock-grasshopper] ${msg.type}`);
				break;

			case 'applySyncChanges':
				send(ws, { type: 'syncApplied', sessionId, success: true });
				break;

			default:
				handleSelva(ws, msg, sessionId);
				break;
		}
	});

	ws.on('close', () => clearTimeout(pendingSolve));
});

wss.on('listening', () => {
	const pagePath = `/builder?session=dev&wsPort=${PORT}#s=${SECRET}`;
	console.info(
		`[mock-grasshopper] ws://localhost:${PORT}  ·  open http://localhost:5173${pagePath}`
	);
	if (process.argv.includes('--with-dev-server')) {
		// Vite's own "Local:" link has no #s= fragment, so the page refuses to connect; open the
		// full URL instead. Windows only resolves pnpm's .cmd shim through a shell, which would
		// read the & and # in the path, hence the quoting there.
		const openArg = process.platform === 'win32' ? `"${pagePath}"` : pagePath;
		const vite = spawn('pnpm', ['dev', '--open', openArg], {
			stdio: 'inherit',
			shell: process.platform === 'win32'
		});
		vite.on('exit', (code) => process.exit(code ?? 0));
	}
});
