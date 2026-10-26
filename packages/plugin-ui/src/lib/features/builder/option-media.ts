import type { UISchema } from '@selvajs/schemas';
import { getAllLayoutItems } from './operations';

/**
 * Drops assets no option points at. Media for an option the list doesn't have right now stays:
 * Grasshopper owns the options, and a renamed or briefly removed one gets its picture back.
 */
export function pruneUnusedMedia(schema: UISchema): void {
	const used = new Set<string>();

	for (const item of getAllLayoutItems(schema)) {
		if (item.type !== 'input') continue;
		if (item.widgetType !== 'dropdown' && item.widgetType !== 'dynamicValueList') continue;
		for (const entry of Object.values(item.config?.optionMedia ?? {})) {
			if (entry?.icon) used.add(entry.icon);
			if (entry?.image) used.add(entry.image);
		}
	}

	if (!schema.assets) return;
	for (const id of Object.keys(schema.assets)) {
		if (!used.has(id)) delete schema.assets[id];
	}
	if (Object.keys(schema.assets).length === 0) delete schema.assets;
}

/** Characters the assets add to the saved schema, which is what the .gh grows by. */
export function assetBytes(assets: UISchema['assets']): number {
	let total = 0;
	for (const asset of Object.values(assets ?? {})) {
		total += (asset?.d ?? asset?.img ?? '').length;
	}
	return total;
}
