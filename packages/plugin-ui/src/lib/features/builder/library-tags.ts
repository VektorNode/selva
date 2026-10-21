import { MAX_TAGS } from '@selvajs/schemas';

/**
 * Adds what the author typed to `tags`. Commas split the entry into several tags: Selva sends
 * tags comma-joined on upload, so a tag holding a comma would come apart there anyway.
 */
export function addTags(tags: readonly string[], entry: string): string[] {
	const next = [...tags];
	for (const tag of entry.split(',').map((t) => t.trim())) {
		if (next.length >= MAX_TAGS) break;
		if (tag && !next.includes(tag)) next.push(tag);
	}
	return next;
}
