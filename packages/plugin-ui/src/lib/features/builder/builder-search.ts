import type { DiscoveredInput, DiscoveredOutput, UISchema } from '@selvajs/schemas';
import { layoutContainers } from './input-sources';

export type SettingsPanel = 'app' | 'viewer' | 'local' | 'compute';

export type SearchTarget =
	| { kind: 'item'; tabId: string; groupId: string; itemId: string }
	| { kind: 'group'; tabId: string; groupId: string }
	| { kind: 'tab'; tabId: string }
	/** A parameter not on the canvas yet; it can only be shown in the sidebar list. */
	| { kind: 'param'; nickname: string }
	| { kind: 'setting'; panel: SettingsPanel; sectionId: string; controlId?: string };

export interface SearchEntry {
	key: string;
	kind: 'input' | 'output' | 'group' | 'tab' | 'setting';
	label: string;
	/** Where the result lives, shown beside the label. */
	detail: string;
	/** Matched but never shown. */
	terms: string;
	target: SearchTarget;
}

const SEARCH_RESULT_LIMIT = 50;

const PANEL_LABELS: Record<SettingsPanel, string> = {
	app: 'App',
	viewer: 'Viewer',
	local: 'Local',
	compute: 'Compute'
};

// Hand-listed: the panels are markup, so nothing fails when a setting is added or an id changes.
// A stale `controlId` still lands on the section.
const SETTINGS: {
	label: string;
	section: string;
	sectionId: string;
	panel: SettingsPanel;
	controlId?: string;
	terms?: string;
}[] = [
	{
		label: 'Name',
		section: 'General',
		sectionId: 'app.general',
		panel: 'app',
		controlId: 'schema-name',
		terms: 'title'
	},
	{
		label: 'Description',
		section: 'General',
		sectionId: 'app.general',
		panel: 'app',
		controlId: 'schema-description'
	},
	{
		label: 'Category',
		section: 'Selva listing',
		sectionId: 'app.listing',
		panel: 'app',
		controlId: 'schema-category'
	},
	{
		label: 'Tags',
		section: 'Selva listing',
		sectionId: 'app.listing',
		panel: 'app',
		controlId: 'schema-tags'
	},
	{
		label: 'Instant solve',
		section: 'Behaviour',
		sectionId: 'app.behaviour',
		panel: 'app',
		controlId: 'instance-solve',
		terms: 'calculate auto'
	},
	{
		label: 'Background',
		section: 'Look',
		sectionId: 'viewer.look',
		panel: 'viewer',
		controlId: 'viewer-background',
		terms: 'color colour'
	},
	{
		label: 'Look',
		section: 'Look',
		sectionId: 'viewer.look',
		panel: 'viewer',
		controlId: 'viewer-look',
		terms: 'theme lighting studio night'
	},
	{
		label: 'Schema file',
		section: 'Schema file',
		sectionId: 'app.file',
		panel: 'app',
		terms: 'export import sls backup'
	},
	{
		label: 'Local render',
		section: 'Live preview',
		sectionId: 'local.preview',
		panel: 'local',
		controlId: 'enable-local-rendering',
		terms: 'mesh stream display'
	},
	{
		label: 'Track picked objects',
		section: 'Rhino',
		sectionId: 'local.rhino',
		panel: 'local',
		controlId: 'track-picked-objects',
		terms: 'geometry viewport'
	},
	{
		label: 'Compute render',
		section: 'Rendering',
		sectionId: 'viewer.rendering',
		panel: 'viewer',
		controlId: 'enable-remote-rendering',
		terms: 'remote geometry'
	},
	{
		label: 'Input sources',
		section: 'Input sources',
		sectionId: 'compute.sources',
		panel: 'compute',
		terms: 'client server'
	}
];

/** Everything findable, in the order equally good matches should appear. */
export function buildSearchEntries(
	schema: UISchema,
	inputs: DiscoveredInput[],
	outputs: DiscoveredOutput[]
): SearchEntry[] {
	const discovered = new Map([...inputs, ...outputs].map((param) => [param.id, param]));
	const placedIds = new Set<string>();
	const placed: SearchEntry[] = [];
	const groupEntries: SearchEntry[] = [];
	const tabEntries: SearchEntry[] = [];

	for (const { tabId, tabLabel, groups } of layoutContainers(schema)) {
		if (tabId) {
			tabEntries.push({
				key: `tab:${tabId}`,
				kind: 'tab',
				label: tabLabel ?? tabId,
				detail: 'Tab',
				terms: '',
				target: { kind: 'tab', tabId }
			});
		}
		for (const group of groups) {
			groupEntries.push({
				key: `group:${group.id}`,
				kind: 'group',
				label: group.label,
				detail: tabLabel ?? '',
				terms: group.description ?? '',
				target: { kind: 'group', tabId, groupId: group.id }
			});
			for (const item of group.items) {
				if (item.type === 'linebreak') continue;
				placedIds.add(item.paramId);
				const param = discovered.get(item.paramId);
				placed.push({
					key: `item:${item.id}`,
					kind: item.type,
					label: item.displayName || param?.nickname || item.paramId,
					detail: tabLabel ? `${tabLabel} › ${group.label}` : group.label,
					terms: `${param?.nickname ?? ''} ${param?.description ?? ''} ${item.widgetType}`,
					target: { kind: 'item', tabId, groupId: group.id, itemId: item.id }
				});
			}
		}
	}

	const unplaced = (params: (DiscoveredInput | DiscoveredOutput)[], kind: 'input' | 'output') =>
		params
			.filter((param) => !placedIds.has(param.id))
			.map((param): SearchEntry => ({
				key: `param:${param.id}`,
				kind,
				label: param.nickname,
				detail: 'Not placed',
				terms: `${param.description ?? ''} ${param.type}`,
				target: { kind: 'param', nickname: param.nickname }
			}));

	const settings = SETTINGS.map(
		({ label, section, sectionId, panel, controlId, terms }): SearchEntry => ({
			key: `setting:${sectionId}:${label}`,
			kind: 'setting',
			label,
			detail: `${PANEL_LABELS[panel]} › ${section}`,
			terms: terms ?? '',
			target: { kind: 'setting', panel, sectionId, controlId }
		})
	);

	return [
		...placed,
		...unplaced(inputs, 'input'),
		...unplaced(outputs, 'output'),
		...groupEntries,
		...tabEntries,
		...settings
	];
}

/** Every word must match somewhere; a match on the label beats one on the hidden terms. */
export function searchEntries(entries: SearchEntry[], query: string): SearchEntry[] {
	const phrase = query.trim().toLowerCase();
	if (!phrase) return [];
	const words = phrase.split(/\s+/);

	const rank = (label: string) => (label.startsWith(phrase) ? 0 : label.includes(phrase) ? 1 : 2);

	return entries
		.flatMap((entry) => {
			const label = entry.label.toLowerCase();
			const text = `${label} ${entry.detail.toLowerCase()} ${entry.terms.toLowerCase()}`;
			return words.every((word) => text.includes(word)) ? [{ entry, rank: rank(label) }] : [];
		})
		.sort((a, b) => a.rank - b.rank)
		.slice(0, SEARCH_RESULT_LIMIT)
		.map(({ entry }) => entry);
}
