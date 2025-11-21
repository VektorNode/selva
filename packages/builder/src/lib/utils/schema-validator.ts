import type { UISchema } from '$lib/types/generated/schema';

export const CURRENT_SCHEMA_VERSION = '1.0.0';

export interface ValidationResult {
  compatible: boolean;
  message?: string;
  needsMigration?: boolean;
}

/**
 * Validate schema version compatibility
 * @param schema The schema to validate
 * @returns Validation result with compatibility status and message
 */
export function validateSchemaVersion(schema: UISchema): ValidationResult {
  if (!schema.schemaVersion) {
    return {
      compatible: true,
      needsMigration: true,
      message: 'Legacy schema detected - will be migrated on save',
    };
  }

  const [major, minor, patch] = schema.schemaVersion.split('.').map(Number);
  const [currentMajor, currentMinor, currentPatch] = CURRENT_SCHEMA_VERSION.split('.').map(Number);

  // Validate version format
  if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
    return {
      compatible: false,
      message: `Invalid schema version format: ${schema.schemaVersion}`,
    };
  }

  // Major version mismatch = incompatible (breaking changes)
  if (major > currentMajor) {
    return {
      compatible: false,
      message: `Schema version ${schema.schemaVersion} requires a newer version of ComputeBuilder`,
    };
  }

  // Minor version behind = needs migration (backward compatible)
  if (major === currentMajor && minor < currentMinor) {
    return {
      compatible: true,
      needsMigration: true,
      message: `Schema will be upgraded from ${schema.schemaVersion} to ${CURRENT_SCHEMA_VERSION}`,
    };
  }

  // Patch version behind = compatible, no migration needed
  if (major === currentMajor && minor === currentMinor && patch < currentPatch) {
    return {
      compatible: true,
      needsMigration: false,
      message: 'Schema is compatible (patch version difference)',
    };
  }

  // Schema is newer but compatible (same major version)
  if (
    major === currentMajor &&
    (minor > currentMinor || (minor === currentMinor && patch > currentPatch))
  ) {
    return {
      compatible: true,
      needsMigration: false,
      message: 'Schema was created with a newer version but is compatible',
    };
  }

  // Exact match
  return { compatible: true };
}

/**
 * Check if schema needs migration
 * @param schema The schema to check
 * @returns True if migration is needed
 */
export function needsMigration(schema: UISchema): boolean {
  return validateSchemaVersion(schema).needsMigration ?? false;
}

/**
 * Parse semantic version string
 * @param version Version string (e.g., "1.0.0")
 * @returns Tuple of [major, minor, patch]
 */
export function parseVersion(version: string): [number, number, number] {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid version format: ${version}`);
  }
  return [parts[0], parts[1], parts[2]];
}

/**
 * Compare two version strings
 * @param v1 First version
 * @param v2 Second version
 * @returns -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
export function compareVersions(v1: string, v2: string): number {
  const [major1, minor1, patch1] = parseVersion(v1);
  const [major2, minor2, patch2] = parseVersion(v2);

  if (major1 !== major2) return major1 < major2 ? -1 : 1;
  if (minor1 !== minor2) return minor1 < minor2 ? -1 : 1;
  if (patch1 !== patch2) return patch1 < patch2 ? -1 : 1;
  return 0;
}
