// Stand-in for Selva.gha's WebSocket so /builder and /preview can be worked on without Rhino.
// Serves a tower-massing definition: a placed layout across several tabs plus unplaced
// parameters for the sidebar. Saves are kept in memory until the process exits.
//
// Separate from e2e/ws-stub.ts on purpose: the E2E stub stays minimal so its assertions
// don't shift whenever this demo data grows.
//
//   pnpm dev:plugin:mock                               mock + Vite dev server
//   node dev/mock-grasshopper.ts [--port 8765] [--latency 250]   mock only

import { spawn } from 'node:child_process';
import { WebSocketServer, type WebSocket } from 'ws';
import { UI_SCHEMA_VERSION } from '@selvajs/schemas';
import type {
	DiscoveredInput,
	DiscoveredOutput,
	GroupConfig,
	GroupVisibilityCondition,
	LayoutItem,
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
// Socket
// ============================================================================

function send(ws: WebSocket, message: Record<string, unknown>) {
	ws.send(JSON.stringify(message));
}

function broadcast(wss: WebSocketServer, message: Record<string, unknown>) {
	for (const client of wss.clients) send(client, message);
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
	let pendingSolve: ReturnType<typeof setTimeout> | undefined;

	ws.on('message', (raw) => {
		let msg: Record<string, unknown> & { type?: string; sessionId?: string };
		try {
			msg = JSON.parse(raw.toString());
		} catch {
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

			case 'applySyncChanges':
				send(ws, { type: 'syncApplied', sessionId, success: true });
				break;
		}
	});

	ws.on('close', () => clearTimeout(pendingSolve));
});

if (process.argv.includes('--with-dev-server')) {
	const vite = spawn('pnpm', ['dev'], { stdio: 'inherit' });
	vite.on('exit', (code) => process.exit(code ?? 0));
}

// eslint-disable-next-line no-console
console.log(
	`[mock-grasshopper] ws://localhost:${PORT}  ·  open http://localhost:5173/builder?session=dev`
);
