import type { InventoryDiff, InventorySummary, InventoryWarning } from '@selvajs/schemas';

/** The `inventory` of a version check, upload or compare response. */
export interface InventoryReport {
	summary: InventorySummary;
	warnings: InventoryWarning[];
	diff: InventoryDiff | null;
	/** `base`: the version compared with has no inventory yet, so `diff` is null. */
	missing: 'base' | null;
}

export async function refreshInventory(
	definitionGuid: string,
	versionId: string
): Promise<string | null> {
	const res = await fetch(`/api/v1/definitions/${definitionGuid}/versions/${versionId}/inventory`, {
		method: 'POST'
	}).catch(() => null);
	if (!res) return 'Could not reach the server.';
	if (res.ok) return null;
	const body = await res.json().catch(() => ({}));
	return body.message || body.error || `The server answered ${res.status}`;
}
