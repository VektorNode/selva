import type { UISchema } from '@selvajs/schemas';
import { getAllLayoutItems } from './operations';

/**
 * Drops what no longer reaches the screen: media for options a static list no longer has, and
 * assets nothing points at. A dynamic list's options exist only at runtime, so its media stays.
 */
export function pruneUnusedMedia(schema: UISchema): void {
	const used = new Set<string>();

	for (const item of getAllLayoutItems(schema)) {
		if (item.type !== 'input') continue;
		if (item.widgetType !== 'dropdown' && item.widgetType !== 'dynamicValueList') continue;
		const config = item.config;
		const media = config?.optionMedia;
		if (!media) continue;

		if (item.widgetType === 'dropdown') {
			const options = item.config.options ?? {};
			for (const name of Object.keys(media)) {
				if (!(name in options)) delete media[name];
			}
		}

		for (const entry of Object.values(media)) {
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
