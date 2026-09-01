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
 * Params the current schema no longer has are dropped. That's the same condition
 * `validateSavedState` flags as an error, but the rule is re-derived from the schema here
 * rather than read back off the issue list: nothing couples to how sentinel ids are encoded.
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

export interface PresetLoadResult {
	/** Safe to apply now: the params that still exist in the schema. */
	values: Record<string, unknown>;
	/** Errors and warnings both, for the load dialog. */
	issues: ValidationIssueMessage[];
	/** No issues at all: load silently. */
	isValid: boolean;
	/** No errors: warnings alone still allow the load. */
	canLoad: boolean;
}

/** Validates and computes the loadable values in one pass, so callers thread one object. */
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
	// .slvp = Selva parameter preset. Import still accepts the pre-rename .sps: same JSON,
	// only the writer's extension changed.
	link.download = `${safeName}_${date}.slvp`;
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
