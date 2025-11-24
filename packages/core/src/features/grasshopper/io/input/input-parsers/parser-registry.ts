import type { InputParamSchema } from '../../../types';

/**
 * Type for a parser function that processes a specific input type
 */
export type ParserFunction = (input: InputParamSchema) => void;

/**
 * Registry mapping parameter types to their parser functions.
 * This eliminates the need for a large switch statement and makes it easier
 * to add new parameter types without modifying the core processing logic.
 *
 * @internal This is an internal parser registry module.
 */
export class ParserRegistry {
  private static parsers: Map<string, ParserFunction> = new Map();

  /**
   * Register a parser function for a given parameter type
   */
  static register(paramType: string, parser: ParserFunction): void {
    this.parsers.set(paramType, parser);
  }

  /**
   * Get a parser for a given parameter type
   */
  static get(paramType: string): ParserFunction | undefined {
    return this.parsers.get(paramType);
  }

  /**
   * Check if a parser exists for a given parameter type
   */
  static has(paramType: string): boolean {
    return this.parsers.has(paramType);
  }

  /**
   * Get all registered parameter types
   */
  static getRegisteredTypes(): string[] {
    return Array.from(this.parsers.keys());
  }

  /**
   * Clear all registered parsers (mainly for testing)
   */
  static clear(): void {
    this.parsers.clear();
  }
}

/**
 * Initialize the parser registry with built-in parsers
 * This is called once during module initialization
 */
export function initializeParserRegistry(): void {
  // Avoid circular dependency issues by using dynamic imports if needed
  // or by importing them separately
}
