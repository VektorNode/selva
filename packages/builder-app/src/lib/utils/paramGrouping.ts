import type { DiscoveredInput, DiscoveredOutput } from '@selvajs/schemas';

export type GroupBy = 'none' | 'prefix' | 'type';

export type GroupedItem = DiscoveredInput | DiscoveredOutput;

export interface ParamCluster {
	key: string;
	label: string;
	items: GroupedItem[];
}

const PREFIX_FALLBACK = 'Other';

/**
 * Derive a cluster key from a parameter's nickname. Splits on the first
 * underscore, dash, or space — common Grasshopper naming conventions like
 * `panel_width`, `panel-height`, `panel count`. Falls back to the whole
 * nickname (or "Other") if no separator exists.
 */
export function getNicknamePrefix(nickname: string | undefined): string {
	if (!nickname) return PREFIX_FALLBACK;
	const trimmed = nickname.trim();
	if (!trimmed) return PREFIX_FALLBACK;
	const match = trimmed.match(/^([^_\-\s]+)[_\-\s]/);
	if (match) return match[1];
	return trimmed.length > 0 ? trimmed : PREFIX_FALLBACK;
}

export function clusterByPrefix(items: GroupedItem[]): ParamCluster[] {
	const map = new Map<string, GroupedItem[]>();
	for (const item of items) {
		const key = getNicknamePrefix(item.nickname);
		const bucket = map.get(key);
		if (bucket) bucket.push(item);
		else map.set(key, [item]);
	}
	return Array.from(map.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, bucketItems]) => ({ key, label: key, items: bucketItems }));
}

export function clusterByType(items: GroupedItem[]): ParamCluster[] {
	const map = new Map<string, GroupedItem[]>();
	for (const item of items) {
		const key = item.type || 'Unknown';
		const bucket = map.get(key);
		if (bucket) bucket.push(item);
		else map.set(key, [item]);
	}
	return Array.from(map.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, bucketItems]) => ({ key, label: key, items: bucketItems }));
}

export function clusterItems(items: GroupedItem[], groupBy: GroupBy): ParamCluster[] {
	if (groupBy === 'prefix') return clusterByPrefix(items);
	if (groupBy === 'type') return clusterByType(items);
	return [{ key: '__all__', label: 'All', items }];
}
