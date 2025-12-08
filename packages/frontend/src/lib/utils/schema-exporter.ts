import type { UISchema, ValidationIssue } from '$lib/types/generated';

export interface SchemaExportMetadata {
  exportedAt: string;
  exportedBy?: string;
  exportVersion: string;
}

export interface ExportedSchema {
  metadata: SchemaExportMetadata;
  schema: UISchema;
}

export interface SchemaValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
  canLoad: boolean;
}

/**
 * Validate an imported schema against the current document
 */
export function validateImportedSchema(
  importedSchema: UISchema,
  currentDocumentId: string,
  currentProjectFileName?: string
): SchemaValidationResult {
  const issues: ValidationIssue[] = [];

  // Check if documentId exists in imported schema
  if (!importedSchema.documentId) {
    issues.push({
      paramId: '__document__',
      severity: 'warning',
      message:
        'Imported schema has no document ID. This may be from an older version or different workflow.'
    });
  }
  // Check document ID match (critical validation)
  else if (importedSchema.documentId !== currentDocumentId) {
    issues.push({
      paramId: '__document__',
      severity: 'error',
      message: 'Document ID mismatch - this schema was created for a different Grasshopper document',
      details: {
        expected: currentDocumentId,
        actual: importedSchema.documentId,
        schemaFileName: importedSchema.projectFileName
      }
    });
  }

  // Check project file name match (warning only)
  if (
    currentProjectFileName &&
    importedSchema.projectFileName &&
    importedSchema.projectFileName !== currentProjectFileName
  ) {
    issues.push({
      paramId: '__project__',
      severity: 'warning',
      message: 'Project file name differs from current document',
      details: {
        expected: currentProjectFileName,
        actual: importedSchema.projectFileName
      }
    });
  }

  // Validate schema structure
  if (!importedSchema.id) {
    issues.push({
      paramId: '__schema__',
      severity: 'error',
      message: 'Schema is missing required ID field'
    });
  }

  if (!importedSchema.name) {
    issues.push({
      paramId: '__schema__',
      severity: 'error',
      message: 'Schema is missing required name field'
    });
  }

  if (!Array.isArray(importedSchema.inputs)) {
    issues.push({
      paramId: '__schema__',
      severity: 'error',
      message: 'Schema inputs must be an array'
    });
  }

  if (!Array.isArray(importedSchema.outputs)) {
    issues.push({
      paramId: '__schema__',
      severity: 'error',
      message: 'Schema outputs must be an array'
    });
  }

  if (!importedSchema.layout || !Array.isArray(importedSchema.layout.tabs)) {
    issues.push({
      paramId: '__schema__',
      severity: 'error',
      message: 'Schema layout is invalid or missing'
    });
  }

  // Check for plugin version compatibility
  if (importedSchema.minPluginVersion) {
    issues.push({
      paramId: '__plugin__',
      severity: 'warning',
      message: `Schema requires minimum plugin version: ${importedSchema.minPluginVersion}`,
      details: {
        minVersion: importedSchema.minPluginVersion,
        currentVersion: importedSchema.pluginVersion
      }
    });
  }

  // Can load if no errors (warnings are ok)
  const hasErrors = issues.some((i) => i.severity === 'error');
  const canLoad = !hasErrors;

  return {
    isValid: issues.length === 0,
    issues,
    canLoad
  };
}

/**
 * Export schema as .sls (Selva Layout State) file
 */
export function exportSchemaAsFile(schema: UISchema, exportedBy?: string): void {
  const exportedSchema: ExportedSchema = {
    metadata: {
      exportedAt: new Date().toISOString(),
      exportedBy,
      exportVersion: '1.0.0'
    },
    schema
  };

  const json = JSON.stringify(exportedSchema, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const sanitizedName = schema.name.replace(/[^a-z0-9]/gi, '_');
  const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '_');
  const fileName = `${sanitizedName}_${timestamp}.sls`;

  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Import schema from .sls (Selva Layout State) file
 */
export async function importSchemaFromFile(file: File): Promise<ExportedSchema> {
  // Validate file extension
  if (!file.name.endsWith('.sls')) {
    throw new Error('Invalid file type. Expected .sls (Selva Layout State) file.');
  }

  const text = await file.text();
  let parsed: ExportedSchema;

  try {
    parsed = JSON.parse(text) as ExportedSchema;
  } catch {
    throw new Error('Invalid JSON format in schema file');
  }

  // Basic structure validation
  if (!parsed.metadata || !parsed.schema) {
    throw new Error('Invalid schema file format. Missing metadata or schema.');
  }

  if (!parsed.schema.id || !parsed.schema.name) {
    throw new Error('Invalid schema structure. Missing required fields.');
  }

  return parsed;
}

/**
 * Prepare imported schema for loading
 * Updates timestamps and generates new ID if needed
 */
export function prepareImportedSchema(
  importedSchema: UISchema,
  options: {
    generateNewId?: boolean;
    updateTimestamp?: boolean;
  } = {}
): UISchema {
  const prepared = { ...importedSchema };

  if (options.generateNewId) {
    prepared.id = crypto.randomUUID();
  }

  if (options.updateTimestamp) {
    prepared.lastModified = new Date().toISOString();
  }

  return prepared;
}
