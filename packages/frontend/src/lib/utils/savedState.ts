import type { UISchema, SavedState, ParameterState, ValidationIssue } from '$lib/types/generated';

/**
 * Create a saved state from current schema and values
 */
export function createSavedState(
  schema: UISchema,
  currentValues: Record<string, unknown>,
  metadata: {
    name: string;
    description?: string;
    author?: string;
    tags?: string[];
  }
): SavedState {
  // Collect parameter states from schema
  const parameters: ParameterState[] = [];

  // Process all layout items to extract parameter info
  if (schema.layout?.tabs) {
    for (const tab of schema.layout.tabs) {
      for (const group of tab.groups || []) {
        for (const item of group.items || []) {
          if (item.type === 'input') {
            const value = currentValues[item.paramId];

            // Find the input parameter definition for type info
            const inputDef = schema.inputs.find(i => i.id === item.paramId);

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
      }
    }
  }

  return {
    id: crypto.randomUUID(),
    name: metadata.name,
    description: metadata.description,
    timestamp: new Date().toISOString(),
    schemaId: schema.id,
    documentId: schema.documentId || '',
    projectFileName: schema.projectFileName || '',
    pluginVersion: schema.pluginVersion || '',
    author: metadata.author,
    tags: metadata.tags || [],
    parameters
  };
}

/**
 * Validate a saved state against the current schema
 */
export function validateSavedState(
  savedState: SavedState,
  currentSchema: UISchema
): {
  isValid: boolean;
  issues: ValidationIssue[];
  canLoad: boolean; // Can we load despite issues?
} {
  const issues: ValidationIssue[] = [];

  // Check document ID match
  if (savedState.documentId !== (currentSchema.documentId || '')) {
    issues.push({
      paramId: '__document__',
      severity: 'error',
      message: 'Document ID mismatch - this state was saved for a different document',
      details: {
        expected: currentSchema.documentId || '',
        actual: savedState.documentId
      }
    });
  }

  // Check schema ID match (warning only)
  if (savedState.schemaId !== currentSchema.id) {
    issues.push({
      paramId: '__schema__',
      severity: 'warning',
      message: 'Schema has changed since this state was saved',
      details: {
        expected: currentSchema.id,
        actual: savedState.schemaId
      }
    });
  }

  // Validate each parameter
  for (const paramState of savedState.parameters) {
    const inputDef = currentSchema.inputs.find(i => i.id === paramState.paramId);

    if (!inputDef) {
      issues.push({
        paramId: paramState.paramId,
        severity: 'error',
        message: `Parameter "${paramState.nickname}" no longer exists in the schema`
      });
      continue;
    }

    // Check nickname changed (warning)
    if (inputDef.nickname !== paramState.nickname) {
      issues.push({
        paramId: paramState.paramId,
        severity: 'warning',
        message: `Parameter nickname changed`,
        details: {
          expected: paramState.nickname,
          actual: inputDef.nickname
        }
      });
    }

    // Check type changed (error)
    if (inputDef.paramType !== paramState.paramType) {
      issues.push({
        paramId: paramState.paramId,
        severity: 'error',
        message: `Parameter "${paramState.nickname}" type changed - cannot load value`,
        details: {
          expected: paramState.paramType,
          actual: inputDef.paramType
        }
      });
    }
  }

  // Can load if no errors (warnings are ok)
  const hasErrors = issues.some(i => i.severity === 'error');
  const canLoad = !hasErrors;

  return {
    isValid: issues.length === 0,
    issues,
    canLoad
  };
}

/**
 * Extract values from saved state that can be safely loaded
 */
export function extractLoadableValues(
  savedState: SavedState,
  currentSchema: UISchema,
  validation: ReturnType<typeof validateSavedState>
): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  // Get param IDs with errors
  const errorParamIds = new Set(
    validation.issues
      .filter(i => i.severity === 'error' && i.paramId !== '__document__' && i.paramId !== '__schema__')
      .map(i => i.paramId)
  );

  // Extract values for parameters without errors
  for (const paramState of savedState.parameters) {
    if (!errorParamIds.has(paramState.paramId)) {
      // Verify parameter still exists
      const inputDef = currentSchema.inputs.find(i => i.id === paramState.paramId);
      if (inputDef) {
        values[paramState.paramId] = paramState.value;
      }
    }
  }

  return values;
}

/**
 * Save state to local storage
 */
export function saveStateToLocalStorage(
  documentId: string,
  savedState: SavedState
): void {
  const key = `selva_states_${documentId}`;

  // Get existing states for this document
  const existingStatesJson = localStorage.getItem(key);
  const existingStates: SavedState[] = existingStatesJson
    ? JSON.parse(existingStatesJson)
    : [];

  // Add or update state
  const existingIndex = existingStates.findIndex(s => s.id === savedState.id);
  if (existingIndex >= 0) {
    existingStates[existingIndex] = savedState;
  } else {
    existingStates.push(savedState);
  }

  // Save back to localStorage
  localStorage.setItem(key, JSON.stringify(existingStates));
}

/**
 * Load all states for a document from local storage
 */
export function loadStatesFromLocalStorage(documentId: string): SavedState[] {
  const key = `selva_states_${documentId}`;
  const statesJson = localStorage.getItem(key);

  if (!statesJson) {
    return [];
  }

  try {
    return JSON.parse(statesJson) as SavedState[];
  } catch (error) {
    console.error('Failed to parse saved states:', error);
    return [];
  }
}

/**
 * Delete a state from local storage
 */
export function deleteStateFromLocalStorage(
  documentId: string,
  stateId: string
): void {
  const key = `selva_states_${documentId}`;
  const statesJson = localStorage.getItem(key);

  if (!statesJson) {
    return;
  }

  try {
    const states: SavedState[] = JSON.parse(statesJson);
    const filtered = states.filter(s => s.id !== stateId);
    localStorage.setItem(key, JSON.stringify(filtered));
  } catch (error) {
    console.error('Failed to delete state:', error);
  }
}

/**
 * Export state as .sps (Selva Param State) file
 */
export function exportStateAsJson(savedState: SavedState): void {
  const json = JSON.stringify(savedState, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${savedState.name.replace(/[^a-z0-9]/gi, '_')}_${savedState.timestamp.split('T')[0].replace(/-/g, '_')}.sps`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Import state from .sps (Selva Param State) file
 */
export async function importStateFromJson(file: File): Promise<SavedState> {
  const text = await file.text();
  const state = JSON.parse(text) as SavedState;

  // Basic validation
  if (!state.id || !state.name || !state.documentId || !state.parameters) {
    throw new Error('Invalid saved state file format');
  }

  return state;
}
