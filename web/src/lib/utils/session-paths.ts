import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Get the temp directory for ComputeBuilder session files
 */
export function getTempDir(): string {
  return join(tmpdir(), 'ComputeBuilder');
}

/**
 * Get the path to a schema file for a session
 */
export function getSchemaPath(sessionId: string): string {
  return join(getTempDir(), `${sessionId}_schema.json`);
}

/**
 * Get the path to a values file for a session
 */
export function getValuesPath(sessionId: string): string {
  return join(getTempDir(), `${sessionId}_values.json`);
}

/**
 * Get the path to a state file for a session
 */
export function getStatePath(sessionId: string): string {
  return join(getTempDir(), `${sessionId}_state.json`);
}

/**
 * Get the path to an available parameters file for a session
 */
export function getAvailablePath(sessionId: string): string {
  return join(getTempDir(), `${sessionId}_available.json`);
}
