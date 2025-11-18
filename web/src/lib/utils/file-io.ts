import { existsSync, readFileSync, writeFileSync } from 'fs';

/**
 * Read a JSON file and parse it
 * @param filePath - Path to the JSON file
 * @param defaultValue - Default value to return if file doesn't exist
 * @returns Parsed JSON data or default value
 */
export function readJsonFile<T>(filePath: string, defaultValue?: T): T {
  if (!existsSync(filePath)) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`File not found: ${filePath}`);
  }

  const data = readFileSync(filePath, 'utf-8');
  return JSON.parse(data) as T;
}

/**
 * Write data to a JSON file with formatting
 * @param filePath - Path to the JSON file
 * @param data - Data to write
 */
export function writeJsonFile<T>(filePath: string, data: T): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Check if a file exists
 * @param filePath - Path to check
 * @returns True if file exists
 */
export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}
