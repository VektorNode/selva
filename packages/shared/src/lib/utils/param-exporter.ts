import { APP_DEFAULTS } from '../constants';
import type {
	UISchema,
	ParameterPreset,
	ParameterState,
	ValidationIssueMessage
} from '../types/generated';

function getGroups(schema: UISchema) {
	if (!schema.layout) return [];
	if (schema.layout.type === 'tabbed') return schema.layout.tabs.flatMap((t) => t.groups ?? []);
	if (schema.layout.type === 'flat') return schema.layout.groups ?? [];
	return [];
}

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
		id: crypto.randomUUID(),
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

export function extractLoadableValues(
	savedState: ParameterPreset,
	currentSchema: UISchema,
	validation: ReturnType<typeof validateSavedState>
): Record<string, unknown> {
	const errorParamIds = new Set(
		validation.issues
			.filter((i) => i.severity === 'error' && !i.paramId.startsWith('__'))
			.map((i) => i.paramId)
	);

	const values: Record<string, unknown> = {};
	for (const paramState of savedState.parameters) {
		const exists = currentSchema.inputs.some((i) => i.id === paramState.paramId);
		if (!errorParamIds.has(paramState.paramId) && exists) {
			values[paramState.paramId] = paramState.value;
		}
	}
	return values;
}

export function exportStateAsJson(savedState: ParameterPreset): void {
	const blob = new Blob([JSON.stringify(savedState, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = `${savedState.name.replace(/[^a-z0-9]/gi, '_')}_${savedState.timestamp.split('T')[0].replace(/-/g, '_')}.sps`;
	link.style.display = 'none';
	document.body.appendChild(link);

	setTimeout(() => {
		link.click();
		setTimeout(() => {
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
		}, APP_DEFAULTS.TIMEOUTS.PARAM_EXPORT_DELAY);
	}, 0);
}

export async function importStateFromJson(file: File): Promise<ParameterPreset> {
	const state = JSON.parse(await file.text()) as ParameterPreset;
	if (!state.id || !state.name || !state.documentId || !state.parameters) {
		throw new Error('Invalid saved state file format');
	}
	return state;
}
