import type { UISchema } from '$lib/types/generated';

export enum ValidationSeverity {
  Info = 'info',
  Warning = 'warning',
  Error = 'error'
}

export interface ValidationIssue {
  paramId?: string;
  severity: ValidationSeverity;
  message: string;
  details?: string;
}

export interface ValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
}

/**
 * Frontend schema validator - performs only basic structural validation
 * Detailed validation is handled by the C# backend (SchemaValidator.cs)
 */
export class SchemaValidator {
  /**
   * Validate basic schema structure before sending to backend
   * The backend will perform comprehensive validation
   */
  validate(schema: UISchema): ValidationResult {
    if (!schema) {
      return {
        isValid: false,
        issues: [
          {
            severity: ValidationSeverity.Error,
            message: 'Schema is null or undefined'
          }
        ]
      };
    }

    const issues: ValidationIssue[] = [];

    // Basic structure validation only
    this.validateBasicStructure(schema, issues);

    return {
      isValid: !issues.some((i) => i.severity === ValidationSeverity.Error),
      issues
    };
  }

  /**
   * Validate that required top-level fields are present
   */
  private validateBasicStructure(schema: UISchema, issues: ValidationIssue[]): void {
    if (!schema.id || schema.id.trim() === '') {
      issues.push({
        severity: ValidationSeverity.Error,
        message: 'Schema ID is required',
        details: 'UISchema.id must be a non-empty string'
      });
    }

    if (!schema.name || schema.name.trim() === '') {
      issues.push({
        severity: ValidationSeverity.Error,
        message: 'Schema name is required',
        details: 'UISchema.name must be a non-empty string'
      });
    }

    if (!Array.isArray(schema.inputs)) {
      issues.push({
        severity: ValidationSeverity.Error,
        message: 'Inputs array is invalid',
        details: 'UISchema.inputs must be an array (can be empty)'
      });
    }

    if (!Array.isArray(schema.outputs)) {
      issues.push({
        severity: ValidationSeverity.Error,
        message: 'Outputs array is invalid',
        details: 'UISchema.outputs must be an array (can be empty)'
      });
    }

    if (!schema.layout) {
      issues.push({
        severity: ValidationSeverity.Error,
        message: 'Layout is required',
        details: 'UISchema.layout must be defined'
      });
    }

    // Info message about backend validation
    issues.push({
      severity: ValidationSeverity.Info,
      message: 'Basic validation passed',
      details: 'Detailed validation will be performed by the backend'
    });
  }
}

/**
 * Helper function to create a validator instance and validate schema
 */
export function validateSchema(schema: UISchema): ValidationResult {
  const validator = new SchemaValidator();
  return validator.validate(schema);
}

/**
 * Helper function to get only errors from validation result
 */
export function getErrors(result: ValidationResult): ValidationIssue[] {
  return result.issues.filter((i) => i.severity === ValidationSeverity.Error);
}

/**
 * Helper function to get only warnings from validation result
 */
export function getWarnings(result: ValidationResult): ValidationIssue[] {
  return result.issues.filter((i) => i.severity === ValidationSeverity.Warning);
}

/**
 * Helper function to get only info messages from validation result
 */
export function getInfos(result: ValidationResult): ValidationIssue[] {
  return result.issues.filter((i) => i.severity === ValidationSeverity.Info);
}

/**
 * Format validation issue for display
 */
export function formatIssue(issue: ValidationIssue): string {
  const prefix =
    issue.severity === ValidationSeverity.Error
      ? 'ERROR'
      : issue.severity === ValidationSeverity.Warning
        ? 'WARNING'
        : 'INFO';

  const location = issue.paramId ? ` (${issue.paramId})` : '';
  const details = issue.details ? ` - ${issue.details}` : '';

  return `[${prefix}]${location}: ${issue.message}${details}`;
}
