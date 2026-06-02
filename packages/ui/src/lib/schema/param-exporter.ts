import { randomId } from '../utils/randomId';
import { getGroups } from '@selvajs/schemas';
import type {
	UISchema,
	ParameterPreset,
	ParameterState,
	ValidationIssueMessage
} from '@selvajs/schemas';

export function createSavedState(
	schema: UISchema,
	currentValues: Record<string, unknown>,
	metadata: {
		name: string;
		description?: string;
		author?: string;
		tags?: string[];
	}
): ParameterPreset {
	const parameters: ParameterState[] = [];

	for (const group of getGroups(schema)) {
		for (const item of group.items ?? []) {
			if (item.type !== 'input') continue;
			const value = currentValues[item.paramId];
			const inputDef = schema.inputs.find((i) => i.id === item.paramId);
			if (value !== undefined && inputDef) {
				parameters.push({
					paramId: item.paramId,
					nickname: inputDef.nickname,
					displayName: item.displayName || inputDef.nickname,
					paramType: inputDef.paramType,
					value,
					groupName: group.label
				});
			}
		}
	}

	return {
		id: randomId(),
		name: metadata.name,
		description: metadata.description,
		timestamp: new Date().toISOString(),
		schemaId: schema.id,
		documentId: schema.documentId ?? '',
		projectFileName: schema.projectFileName ?? '',
		pluginVersion: schema.pluginVersion ?? '',
		author: metadata.author,
		tags: metadata.tags ?? [],
		parameters
	};
}

export function validateSavedState(
	savedState: ParameterPreset,
	currentSchema: UISchema
): {
	isValid: boolean;
	issues: ValidationIssueMessage[];
	canLoad: boolean;
} {
	const issues: ValidationIssueMessage[] = [];

	if (savedState.documentId !== (currentSchema.documentId ?? '')) {
		issues.push({
			paramId: '__document__',
			severity: 'error',
			message: 'Document ID mismatch - this state was saved for a different document',
			details: { expected: currentSchema.documentId ?? '', actual: savedState.documentId }
		});
	}

	if (savedState.schemaId !== currentSchema.id) {
		issues.push({
			paramId: '__schema__',
			severity: 'warning',
			message: 'Schema has changed since this state was saved',
			details: { expected: currentSchema.id, actual: savedState.schemaId }
		});
	}

	for (const paramState of savedState.parameters) {
		const inputDef = currentSchema.inputs.find((i) => i.id === paramState.paramId);

		if (!inputDef) {
			issues.push({
				paramId: paramState.paramId,
				severity: 'error',
				message: `Parameter "${paramState.nickname}" no longer exists in the schema`
			});
			continue;
		}

		if (inputDef.nickname !== paramState.nickname) {
			issues.push({
				paramId: paramState.paramId,
				severity: 'warning',
				message: 'Parameter nickname changed',
				details: { expected: paramState.nickname, actual: inputDef.nickname }
			});
		}
	}

	const hasErrors = issues.some((i) => i.severity === 'error');
	return { isValid: issues.length === 0, issues, canLoad: !hasErrors };
}

/**
 * The subset of a preset's parameters that can safely be applied to the current schema:
 * every param that still exists as an input. A param that no longer exists is dropped
 * (it's the same condition `validateSavedState` flags as an error), so this derives its
 * own "loadable" rule from the schema rather than re-reading validation issues — no
 * coupling to how sentinel ids are encoded.
 */
export function extractLoadableValues(
	savedState: ParameterPreset,
	currentSchema: UISchema
): Record<string, unknown> {
	const values: Record<string, unknown> = {};
	for (const paramState of savedState.parameters) {
		const exists = currentSchema.inputs.some((i) => i.id === paramState.paramId);
		if (exists) {
			values[paramState.paramId] = paramState.value;
		}
	}
	return values;
}

/** The full outcome of loading a preset: what to apply, plus the diagnostics to surface. */
export interface PresetLoadResult {
	/** Values safe to apply now (params that still exist). */
	values: Record<string, unknown>;
	/** All validation issues (errors + warnings) for the load dialog. */
	issues: ValidationIssueMessage[];
	/** No issues at all — load silently. */
	isValid: boolean;
	/** No blocking errors — load is allowed (warnings are fine). */
	canLoad: boolean;
}

/**
 * Single entry point for applying a preset: validates against the current schema and, in
 * the same pass, computes the loadable values. Callers get one object instead of
 * threading a validation result back into a separate extraction step.
 */
export function loadPreset(savedState: ParameterPreset, currentSchema: UISchema): PresetLoadResult {
	const validation = validateSavedState(savedState, currentSchema);
	return {
		values: extractLoadableValues(savedState, currentSchema),
		issues: validation.issues,
		isValid: validation.isValid,
		canLoad: validation.canLoad
	};
}

export function exportStateAsJson(savedState: ParameterPreset): void {
	const blob = new Blob([JSON.stringify(savedState, null, 2)], { type: 'application/json' });
	const safeName = savedState.name.replace(/[^a-z0-9]/gi, '_');
	const date = savedState.timestamp.split('T')[0].replace(/-/g, '_');

	const link = document.createElement('a');
	link.href = URL.createObjectURL(blob);
	link.download = `${safeName}_${date}.sps`;
	link.click();
	URL.revokeObjectURL(link.href);
}

export async function importStateFromJson(file: File): Promise<ParameterPreset> {
	const state = JSON.parse(await file.text()) as ParameterPreset;
	if (!state.id || !state.name || !state.documentId || !state.parameters) {
		throw new Error('Invalid saved state file format');
	}
	return state;
}
