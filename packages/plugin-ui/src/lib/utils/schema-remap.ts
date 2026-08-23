import type { UISchema, DiscoveredInput, DiscoveredOutput } from '@selvajs/schemas';
import { getGroups, getLayoutItems } from '@selvajs/schemas';

// ============================================================================
// Import remap by nickname
// ============================================================================
//
// Grasshopper parameter InstanceGuids are minted per document instance: the same .gh
// opened in a different session — or a schema exported from one document and imported
// into another — carries IDs that no longer resolve on the live canvas. On save the
// plugin purges every input/output/layout item whose id is not found on the document,
// so a raw import silently loses all its parameters.
//
// Nickname is the stable identity across instances. This remaps an imported schema's
// parameter ids/paramIds onto the live canvas by joining on nickname, so the saved
// schema references real, resolvable params and survives reconciliation.

export interface RemapResult {
	schema: UISchema;
	/** Nicknames present in the imported schema with no live counterpart (will be dropped on save). */
	unmatched: string[];
	/** Number of input/output entries successfully rebound to a live param id. */
	remappedCount: number;
}

/** Build a nickname → live param id lookup. Last writer wins on duplicate nicknames. */
function buildNicknameIndex(
	liveInputs: DiscoveredInput[],
	liveOutputs: DiscoveredOutput[]
): Map<string, string> {
	const index = new Map<string, string>();
	for (const input of liveInputs) index.set(input.nickname, input.id);
	for (const output of liveOutputs) index.set(output.nickname, output.id);
	return index;
}

/**
 * Rewrite every parameter reference in `imported` to the live canvas param sharing its
 * nickname. Inputs/outputs with no live match keep their stale id (and are reported as
 * unmatched); layout items and visibility conditions pointing at unmatched params keep
 * their stale paramId too — the plugin will purge them on save, exactly as before, but
 * everything that *can* bind, does.
 */
export function remapImportedSchema(
	imported: UISchema,
	liveInputs: DiscoveredInput[],
	liveOutputs: DiscoveredOutput[]
): RemapResult {
	const index = buildNicknameIndex(liveInputs, liveOutputs);
	const oldToNew = new Map<string, string>();
	const unmatched: string[] = [];
	let remappedCount = 0;

	const rebind = (oldId: string, nickname: string): string => {
		const liveId = index.get(nickname);
		if (liveId === undefined) {
			if (!unmatched.includes(nickname)) unmatched.push(nickname);
			return oldId;
		}
		oldToNew.set(oldId, liveId);
		remappedCount++;
		return liveId;
	};

	for (const input of imported.inputs) input.id = rebind(input.id, input.nickname);
	for (const output of imported.outputs) output.id = rebind(output.id, output.nickname);

	// Layout items, group conditions, and visibility conditions reference params by id;
	// translate through the id map we just built. Unmatched ids pass through unchanged.
	const remapRules = (rules: ReadonlyArray<{ paramId: string }> | undefined): void => {
		if (!rules) return;
		for (const rule of rules) {
			const ruleMapped = oldToNew.get(rule.paramId);
			if (ruleMapped !== undefined) rule.paramId = ruleMapped;
		}
	};

	for (const item of getLayoutItems(imported)) {
		if (item.type === 'linebreak') continue;
		const mapped = oldToNew.get(item.paramId);
		if (mapped !== undefined) item.paramId = mapped;
		remapRules(item.visibilityCondition?.rules);
	}

	for (const group of getGroups(imported)) {
		remapRules(group.visibilityCondition?.rules);
	}

	return { schema: imported, unmatched, remappedCount };
}
